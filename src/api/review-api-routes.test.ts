// @vitest-environment node

import JSZip from "jszip";
import type { ReviewChatResponse } from "@/domain/chat";
import { resetDefaultReviewStoreForTests } from "@/server/reviews";
import { resetReviewServiceStateForTests } from "@/server/reviews/review-service";
import { POST as chatPOST } from "@/app/api/v1/review-cases/[caseId]/chat/route";
import {
  PATCH as draftPATCH,
  POST as draftPOST
} from "@/app/api/v1/review-cases/[caseId]/draft/route";
import { GET as detailGET } from "@/app/api/v1/review-cases/[caseId]/route";
import { POST as analysisPOST } from "@/app/api/v1/review-cases/[caseId]/analysis/start/route";
import { GET as analysisStatusGET } from "@/app/api/v1/review-cases/[caseId]/analysis/status/route";
import { GET as auditEventsGET } from "@/app/api/v1/review-cases/[caseId]/audit-events/route";
import { POST as finalizePOST } from "@/app/api/v1/review-cases/[caseId]/finalize/route";
import { POST as reportPOST } from "@/app/api/v1/review-cases/[caseId]/reports/generate/route";
import { GET as issuesGET } from "@/app/api/v1/review-cases/[caseId]/issues/route";
import { PATCH as issuePATCH } from "@/app/api/v1/review-cases/[caseId]/issues/[issueId]/route";
import { GET as listGET, POST as createPOST } from "@/app/api/v1/review-cases/route";
import { GET as evidenceGET } from "@/app/api/v1/issues/[issueId]/evidence/route";
import { GET as knowledgeGET, POST as knowledgePOST } from "@/app/api/v1/knowledge-documents/route";
import { GET as samplePackageGET } from "@/app/api/v1/sample-packages/[samplePackageId]/route";
import { GET as samplePackagesGET } from "@/app/api/v1/sample-packages/route";

function jsonRequest(path: string, body: unknown, method = "POST") {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function jsonRoleRequest(path: string, body: unknown, role: string, method = "POST") {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json", "x-finproof-role": role },
    body: JSON.stringify(body)
  });
}

function roleRequest(path: string, role: string, method = "POST") {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "x-finproof-role": role }
  });
}

function params<T extends Record<string, string>>(value: T) {
  return { params: Promise.resolve(value) };
}

async function zipBody(entries: Record<string, string>) {
  const zip = new JSZip();

  for (const [name, content] of Object.entries(entries)) {
    zip.file(name, content);
  }

  return zip.generateAsync({ type: "uint8array" });
}

describe("review API routes", () => {
  beforeEach(() => {
    process.env.FINPROOF_ENABLE_SAMPLE_DATA = "true";
    resetDefaultReviewStoreForTests();
    resetReviewServiceStateForTests();
  });

  afterEach(() => {
    delete process.env.FINPROOF_ENABLE_SAMPLE_DATA;
    resetDefaultReviewStoreForTests();
  });

  it("starts from an empty queue and rejects sample routes when sample data is disabled", async () => {
    delete process.env.FINPROOF_ENABLE_SAMPLE_DATA;
    resetDefaultReviewStoreForTests();

    const listResponse = await listGET();
    const listBody = await listResponse.json();
    const sampleListResponse = await samplePackagesGET();
    const sampleCreateResponse = await createPOST(
      jsonRequest("/api/v1/review-cases", { samplePackageId: "rc-demo-deposit-001" })
    );

    expect(listResponse.status).toBe(200);
    expect(listBody.reviewCases).toEqual([]);
    expect(sampleListResponse.status).toBe(404);
    expect(sampleCreateResponse.status).toBe(415);
  });

  it("lists, creates, analyzes, and reads sample-backed review cases", async () => {
    const listResponse = await listGET();
    const listBody = await listResponse.json();

    expect(listResponse.status).toBe(200);
    expect(listBody.reviewCases.map((reviewCase: { id: string }) => reviewCase.id)).toEqual([
      "rc-demo-deposit-001",
      "rc-demo-loan-001"
    ]);

    const createResponse = await createPOST(
      jsonRequest("/api/v1/review-cases", { samplePackageId: "rc-demo-deposit-001" })
    );
    const createBody = await createResponse.json();

    expect(createResponse.status).toBe(201);
    expect(createBody.reviewCase).toMatchObject({
      id: "rc-demo-deposit-001",
      status: "analysis_waiting"
    });
    expect(createBody.files[0]).toMatchObject({
      storageProvider: "sample",
      storageKey: "sample/rc-demo-deposit-001/deposit-poster.png"
    });

    const analysisResponse = await analysisPOST(
      jsonRequest("/api/v1/review-cases/rc-demo-deposit-001/analysis/start", {}),
      params({ caseId: "rc-demo-deposit-001" })
    );
    const analysisBody = await analysisResponse.json();

    expect(analysisResponse.status).toBe(200);
    expect(analysisBody).toMatchObject({
      reviewCaseId: "rc-demo-deposit-001",
      status: "analysis_complete",
      issueCount: 3,
      jobId: "job-rc-demo-deposit-001-001"
    });

    const detailResponse = await detailGET(
      new Request("http://localhost/api/v1/review-cases/rc-demo-deposit-001"),
      params({ caseId: "rc-demo-deposit-001" })
    );
    const detailBody = await detailResponse.json();

    expect(detailResponse.status).toBe(200);
    expect(detailBody.reviewCase).toMatchObject({
      id: "rc-demo-deposit-001",
      status: "analysis_complete"
    });
  });

  it("creates upload-backed review cases from multipart files", async () => {
    const boundary = "----finproof-upload-test";
    const multipartBody = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="title"',
      "",
      "실제 업로드 적금 홍보물",
      `--${boundary}`,
      'Content-Disposition: form-data; name="affiliate"',
      "",
      "광주은행",
      `--${boundary}`,
      'Content-Disposition: form-data; name="productType"',
      "",
      "deposit",
      `--${boundary}`,
      'Content-Disposition: form-data; name="channelType"',
      "",
      "poster",
      `--${boundary}`,
      'Content-Disposition: form-data; name="plannedPublishDate"',
      "",
      "2026-06-20",
      `--${boundary}`,
      'Content-Disposition: form-data; name="files"; filename="real-deposit-poster.png"',
      "Content-Type: image/png",
      "",
      "poster",
      `--${boundary}`,
      'Content-Disposition: form-data; name="files"; filename="real-deposit-rate-table.xlsx"',
      "Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "",
      "rate",
      `--${boundary}--`,
      ""
    ].join("\r\n");

    const createResponse = await createPOST(
      new Request("http://localhost/api/v1/review-cases", {
        method: "POST",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        body: multipartBody
      })
    );
    const createBody = await createResponse.json();

    expect(createResponse.status).toBe(201);
    expect(createBody.reviewCase).toMatchObject({
      id: "rc-upload-001",
      status: "analysis_waiting",
      analysisNotice: "실제 업로드 건은 OCR/RAG 분석 전이므로 근거 부족 상태로 표시됩니다."
    });
    expect(createBody.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "real-deposit-poster.png",
          fileType: "promotional_creative",
          storageProvider: "local"
        }),
        expect.objectContaining({
          name: "real-deposit-rate-table.xlsx",
          fileType: "rate_table"
        })
      ])
    );
    expect(createBody.missingMaterials).toEqual(expect.arrayContaining(["internal_checklist"]));

    const analysisResponse = await analysisPOST(
      jsonRequest("/api/v1/review-cases/rc-upload-001/analysis/start", {}),
      params({ caseId: "rc-upload-001" })
    );
    const analysisBody = await analysisResponse.json();

    expect(analysisResponse.status).toBe(200);
    expect(analysisBody).toMatchObject({
      reviewCaseId: "rc-upload-001",
      status: "analysis_complete",
      issueCount: 1,
      jobId: "job-rc-upload-001-001",
      analysisNotice: "실제 업로드 건은 OCR/RAG 분석 전이므로 근거 부족 상태로 표시됩니다."
    });
  });

  it("registers an attached knowledge document and returns ingestion metadata", async () => {
    const boundary = "----finproof-knowledge-test";
    const multipartBody = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="title"',
      "",
      "예금 광고 심의 지침",
      `--${boundary}`,
      'Content-Disposition: form-data; name="version"',
      "",
      "2026.05",
      `--${boundary}`,
      'Content-Disposition: form-data; name="documentType"',
      "",
      "internal_policy",
      `--${boundary}`,
      'Content-Disposition: form-data; name="productType"',
      "",
      "deposit",
      `--${boundary}`,
      'Content-Disposition: form-data; name="effectiveFrom"',
      "",
      "2026-05-01",
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="deposit-policy.txt"',
      "Content-Type: text/plain",
      "",
      "최고 금리 표현은 우대 조건과 한도를 같은 화면에 표시해야 합니다.",
      `--${boundary}--`,
      ""
    ].join("\r\n");

    const createResponse = await knowledgePOST(
      new Request("http://localhost/api/v1/knowledge-documents", {
        method: "POST",
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
          "x-finproof-role": "reviewer"
        },
        body: multipartBody
      })
    );
    const createBody = await createResponse.json();
    const listResponse = await knowledgeGET(
      roleRequest("/api/v1/knowledge-documents", "reviewer", "GET")
    );
    const listBody = await listResponse.json();

    expect(createResponse.status).toBe(201);
    expect(createBody.document).toMatchObject({
      title: "예금 광고 심의 지침",
      version: "2026.05",
      approvalStatus: "draft",
      storageKey: expect.stringContaining("knowledge-documents")
    });
    expect(createBody.ingestion).toMatchObject({
      chunkCount: 1,
      embeddingModel: expect.any(String)
    });
    expect(listResponse.status).toBe(200);
    expect(listBody.documents).toEqual([
      expect.objectContaining({
        id: createBody.document.id,
        title: "예금 광고 심의 지침"
      })
    ]);
  });

  it("blocks requester analysis start and allows reviewer analysis start", async () => {
    await createPOST(
      jsonRequest("/api/v1/review-cases", { samplePackageId: "rc-demo-deposit-001" })
    );

    const requesterResponse = await analysisPOST(
      roleRequest("/api/v1/review-cases/rc-demo-deposit-001/analysis/start", "requester"),
      params({ caseId: "rc-demo-deposit-001" })
    );
    const requesterBody = await requesterResponse.json();

    expect(requesterResponse.status).toBe(403);
    expect(requesterBody.error.message).toContain("Reviewer");

    const reviewerResponse = await analysisPOST(
      roleRequest("/api/v1/review-cases/rc-demo-deposit-001/analysis/start", "reviewer"),
      params({ caseId: "rc-demo-deposit-001" })
    );
    const reviewerBody = await reviewerResponse.json();

    expect(reviewerResponse.status).toBe(200);
    expect(reviewerBody).toMatchObject({
      reviewCaseId: "rc-demo-deposit-001",
      status: "analysis_complete",
      jobId: "job-rc-demo-deposit-001-001"
    });
  });

  it("returns role-aware review list actions", async () => {
    await createPOST(
      jsonRequest("/api/v1/review-cases", { samplePackageId: "rc-demo-deposit-001" })
    );

    const requesterResponse = await listGET(
      roleRequest("/api/v1/review-cases", "requester", "GET")
    );
    const requesterBody = await requesterResponse.json();
    const requesterCase = requesterBody.reviewCases.find(
      (reviewCase: { id: string }) => reviewCase.id === "rc-demo-deposit-001"
    );

    expect(requesterCase.availableActions).toEqual([]);

    const reviewerResponse = await listGET(roleRequest("/api/v1/review-cases", "reviewer", "GET"));
    const reviewerBody = await reviewerResponse.json();
    const reviewerCase = reviewerBody.reviewCases.find(
      (reviewCase: { id: string }) => reviewCase.id === "rc-demo-deposit-001"
    );

    expect(reviewerCase.availableActions).toEqual(["start_analysis"]);

    await analysisPOST(
      roleRequest("/api/v1/review-cases/rc-demo-deposit-001/analysis/start", "reviewer"),
      params({ caseId: "rc-demo-deposit-001" })
    );

    const analyzedResponse = await listGET(roleRequest("/api/v1/review-cases", "reviewer", "GET"));
    const analyzedBody = await analyzedResponse.json();
    const analyzedCase = analyzedBody.reviewCases.find(
      (reviewCase: { id: string }) => reviewCase.id === "rc-demo-deposit-001"
    );

    expect(analyzedCase.availableActions).toEqual(["open_workbench", "view_audit"]);
  });

  it("serves analysis status and review-case audit events", async () => {
    await createPOST(
      jsonRequest("/api/v1/review-cases", { samplePackageId: "rc-demo-deposit-001" })
    );

    const waitingStatusResponse = await analysisStatusGET(
      roleRequest("/api/v1/review-cases/rc-demo-deposit-001/analysis/status", "reviewer", "GET"),
      params({ caseId: "rc-demo-deposit-001" })
    );
    const waitingStatusBody = await waitingStatusResponse.json();

    expect(waitingStatusResponse.status).toBe(200);
    expect(waitingStatusBody).toMatchObject({
      reviewCaseId: "rc-demo-deposit-001",
      status: "not_started",
      progress: 0,
      currentStep: "waiting_for_reviewer",
      jobId: null
    });

    await analysisPOST(
      roleRequest("/api/v1/review-cases/rc-demo-deposit-001/analysis/start", "reviewer"),
      params({ caseId: "rc-demo-deposit-001" })
    );

    const completedStatusResponse = await analysisStatusGET(
      roleRequest("/api/v1/review-cases/rc-demo-deposit-001/analysis/status", "reviewer", "GET"),
      params({ caseId: "rc-demo-deposit-001" })
    );
    const completedStatusBody = await completedStatusResponse.json();

    expect(completedStatusResponse.status).toBe(200);
    expect(completedStatusBody).toMatchObject({
      reviewCaseId: "rc-demo-deposit-001",
      status: "completed",
      progress: 100,
      currentStep: "worker_completed",
      jobId: "job-rc-demo-deposit-001-001"
    });

    const auditResponse = await auditEventsGET(
      roleRequest("/api/v1/review-cases/rc-demo-deposit-001/audit-events", "reviewer", "GET"),
      params({ caseId: "rc-demo-deposit-001" })
    );
    const auditBody = await auditResponse.json();

    expect(auditResponse.status).toBe(200);
    expect(auditBody.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "analysis.start",
          targetType: "review_case",
          targetId: "rc-demo-deposit-001"
        })
      ])
    );

    const missingStatusResponse = await analysisStatusGET(
      roleRequest("/api/v1/review-cases/missing-case/analysis/status", "reviewer", "GET"),
      params({ caseId: "missing-case" })
    );
    const missingAuditResponse = await auditEventsGET(
      roleRequest("/api/v1/review-cases/missing-case/audit-events", "reviewer", "GET"),
      params({ caseId: "missing-case" })
    );

    expect(missingStatusResponse.status).toBe(404);
    expect(missingAuditResponse.status).toBe(404);
  });

  it("blocks requester reviewer-only workbench mutations", async () => {
    const generateResponse = await draftPOST(
      jsonRoleRequest(
        "/api/v1/review-cases/rc-demo-deposit-001/draft",
        { markedResponses: [] },
        "requester"
      ),
      params({ caseId: "rc-demo-deposit-001" })
    );
    const saveResponse = await draftPATCH(
      jsonRoleRequest(
        "/api/v1/review-cases/rc-demo-deposit-001/draft",
        { draft: "요청자가 저장하려는 의견 초안" },
        "requester",
        "PATCH"
      ),
      params({ caseId: "rc-demo-deposit-001" })
    );
    const reportResponse = await reportPOST(
      jsonRoleRequest(
        "/api/v1/review-cases/rc-demo-deposit-001/reports/generate",
        { reportType: "change_request" },
        "requester"
      ),
      params({ caseId: "rc-demo-deposit-001" })
    );

    expect(generateResponse.status).toBe(403);
    expect(saveResponse.status).toBe(403);
    expect(reportResponse.status).toBe(403);
  });

  it("rejects upload-backed review cases that violate the demo upload policy", async () => {
    const boundary = "----finproof-upload-policy-test";
    const multipartBody = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="productType"',
      "",
      "deposit",
      `--${boundary}`,
      'Content-Disposition: form-data; name="files"; filename="malware.exe"',
      "Content-Type: application/octet-stream",
      "",
      "binary",
      `--${boundary}--`,
      ""
    ].join("\r\n");

    const createResponse = await createPOST(
      new Request("http://localhost/api/v1/review-cases", {
        method: "POST",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        body: multipartBody
      })
    );
    const createBody = await createResponse.json();

    expect(createResponse.status).toBe(400);
    expect(createBody.error.message).toContain("지원하지 않는 파일 형식입니다: malware.exe");
  });

  it("rejects upload-backed review cases with a mismatched extension and MIME type", async () => {
    const boundary = "----finproof-upload-mime-policy-test";
    const multipartBody = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="productType"',
      "",
      "deposit",
      `--${boundary}`,
      'Content-Disposition: form-data; name="files"; filename="payload.zip"',
      "Content-Type: image/png",
      "",
      "not-a-zip",
      `--${boundary}--`,
      ""
    ].join("\r\n");

    const createResponse = await createPOST(
      new Request("http://localhost/api/v1/review-cases", {
        method: "POST",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        body: multipartBody
      })
    );
    const createBody = await createResponse.json();

    expect(createResponse.status).toBe(400);
    expect(createBody.error.message).toContain("지원하지 않는 파일 형식입니다: payload.zip");
  });

  it("rejects upload-backed ZIP packages with unsafe entry paths", async () => {
    const archiveBody = await zipBody({
      "../escape.png": "poster"
    });
    const formData = new FormData();
    formData.set("productType", "deposit");
    formData.set(
      "files",
      new Blob([archiveBody as BlobPart], { type: "application/zip" }),
      "review-package.zip"
    );

    const createResponse = await createPOST(
      new Request("http://localhost/api/v1/review-cases", {
        method: "POST",
        body: formData
      })
    );
    const createBody = await createResponse.json();

    expect(createResponse.status).toBe(400);
    expect(createBody.error).toMatchObject({
      code: "UNSAFE_ARCHIVE"
    });
  });

  it("rejects upload-backed review cases flagged by the upload scanner", async () => {
    const originalEnv = process.env;
    const originalFetch = globalThis.fetch;
    const boundary = "----finproof-upload-scan-test";
    const multipartBody = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="productType"',
      "",
      "deposit",
      `--${boundary}`,
      'Content-Disposition: form-data; name="files"; filename="poster.png"',
      "Content-Type: image/png",
      "",
      "poster",
      `--${boundary}--`,
      ""
    ].join("\r\n");

    process.env = {
      ...originalEnv,
      FINPROOF_UPLOAD_SCAN_PROVIDER: "http",
      FINPROOF_UPLOAD_SCAN_ENDPOINT: "https://scanner.example.com/scan"
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "infected",
        scanner: "fixture-scanner",
        signature: "EICAR-Test-File"
      })
    });

    try {
      const createResponse = await createPOST(
        new Request("http://localhost/api/v1/review-cases", {
          method: "POST",
          headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
          body: multipartBody
        })
      );
      const createBody = await createResponse.json();

      expect(createResponse.status).toBe(400);
      expect(createBody.error).toMatchObject({
        code: "UNSAFE_UPLOAD"
      });
      expect(createBody.error.message).toContain("EICAR-Test-File");
    } finally {
      process.env = originalEnv;
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects upload-backed review cases above the demo file count limit", async () => {
    const boundary = "----finproof-upload-count-policy-test";
    const fileParts = Array.from({ length: 11 }, (_, index) =>
      [
        `--${boundary}`,
        `Content-Disposition: form-data; name="files"; filename="poster-${index}.png"`,
        "Content-Type: image/png",
        "",
        "poster"
      ].join("\r\n")
    );
    const multipartBody = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="productType"',
      "",
      "deposit",
      ...fileParts,
      `--${boundary}--`,
      ""
    ].join("\r\n");

    const createResponse = await createPOST(
      new Request("http://localhost/api/v1/review-cases", {
        method: "POST",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        body: multipartBody
      })
    );
    const createBody = await createResponse.json();

    expect(createResponse.status).toBe(400);
    expect(createBody.error.message).toContain("최대 10개 파일까지 업로드할 수 있습니다.");
  });

  it("serves sample package choices and deterministic preview metadata", async () => {
    const packagesResponse = await samplePackagesGET();
    const packagesBody = await packagesResponse.json();

    expect(packagesResponse.status).toBe(200);
    expect(packagesBody.packages.map((samplePackage: { id: string }) => samplePackage.id)).toEqual([
      "rc-demo-deposit-001",
      "rc-demo-loan-001"
    ]);

    const previewResponse = await samplePackageGET(
      new Request("http://localhost/api/v1/sample-packages/rc-demo-deposit-001"),
      params({ samplePackageId: "rc-demo-deposit-001" })
    );
    const previewBody = await previewResponse.json();

    expect(previewResponse.status).toBe(200);
    expect(previewBody.preview).toMatchObject({
      reviewCaseId: "rc-demo-deposit-001",
      issueCount: 3
    });
    expect(previewBody.requiredMaterials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "홍보물 시안", status: "present" }),
        expect.objectContaining({ label: "내부 체크리스트", status: "missing" })
      ])
    );
    expect(previewBody.extraMissingMaterials).toEqual(["terms"]);
  });

  it("serves issues, evidence, chat, draft, and reviewer decisions", async () => {
    const issuesResponse = await issuesGET(
      new Request("http://localhost/api/v1/review-cases/rc-demo-deposit-001/issues?riskLevel=high"),
      params({ caseId: "rc-demo-deposit-001" })
    );
    const issuesBody = await issuesResponse.json();

    expect(issuesResponse.status).toBe(200);
    expect(issuesBody.issues.map((issue: { targetText: string }) => issue.targetText)).toEqual([
      "최고 연 5.0%",
      "누구나 최고금리 혜택"
    ]);

    const evidenceResponse = await evidenceGET(
      new Request("http://localhost/api/v1/issues/issue-deposit-rate/evidence"),
      params({ issueId: "issue-deposit-rate" })
    );
    const evidenceBody = await evidenceResponse.json();

    expect(evidenceResponse.status).toBe(200);
    expect(evidenceBody.evidence.map((evidence: { title: string }) => evidence.title)).toContain(
      "정기적금 상품설명서"
    );

    const missingTermsResponse = await chatPOST(
      jsonRequest("/api/v1/review-cases/rc-demo-deposit-001/chat", {
        issueId: "issue-deposit-rate",
        question: "약관에만 있는 중도해지 조건도 단정해도 되나요?"
      }),
      params({ caseId: "rc-demo-deposit-001" })
    );
    const missingTermsBody = await missingTermsResponse.json();

    expect(missingTermsResponse.status).toBe(200);
    expect(missingTermsBody.response).toMatchObject({
      answerType: "insufficient_evidence",
      requiredMaterials: ["약관"]
    });

    const evidenceChatResponse = await chatPOST(
      jsonRequest("/api/v1/review-cases/rc-demo-deposit-001/chat", {
        issueId: "issue-deposit-rate",
        question: "우대금리 조건을 어느 수준까지 표시해야 하나요?"
      }),
      params({ caseId: "rc-demo-deposit-001" })
    );
    const evidenceChatBody = (await evidenceChatResponse.json()) as {
      response: ReviewChatResponse;
    };

    const draftResponse = await draftPOST(
      jsonRequest("/api/v1/review-cases/rc-demo-deposit-001/draft", {
        chatResponses: [evidenceChatBody.response]
      }),
      params({ caseId: "rc-demo-deposit-001" })
    );
    const draftBody = await draftResponse.json();

    expect(draftResponse.status).toBe(200);
    expect(draftBody.draft).toContain("채팅 반영");
    expect(draftBody.version).toBe(1);

    const saveDraftResponse = await draftPATCH(
      jsonRequest(
        "/api/v1/review-cases/rc-demo-deposit-001/draft",
        {
          draft: "Reviewer가 직접 편집한 수정 요청 의견 초안"
        },
        "PATCH"
      ),
      params({ caseId: "rc-demo-deposit-001" })
    );
    const saveDraftBody = await saveDraftResponse.json();

    expect(saveDraftResponse.status).toBe(200);
    expect(saveDraftBody).toMatchObject({
      draft: "Reviewer가 직접 편집한 수정 요청 의견 초안",
      version: 2
    });

    const savedDraftDetailResponse = await detailGET(
      new Request("http://localhost/api/v1/review-cases/rc-demo-deposit-001"),
      params({ caseId: "rc-demo-deposit-001" })
    );
    const savedDraftDetailBody = await savedDraftDetailResponse.json();

    expect(savedDraftDetailBody.reviewCase).toMatchObject({
      currentDraft: "Reviewer가 직접 편집한 수정 요청 의견 초안",
      currentDraftVersion: 2
    });

    const invalidSaveDraftResponse = await draftPATCH(
      jsonRequest(
        "/api/v1/review-cases/rc-demo-deposit-001/draft",
        {
          draft: " "
        },
        "PATCH"
      ),
      params({ caseId: "rc-demo-deposit-001" })
    );
    const invalidSaveDraftBody = await invalidSaveDraftResponse.json();

    expect(invalidSaveDraftResponse.status).toBe(400);
    expect(invalidSaveDraftBody.error.message).toContain("draft");

    const nonStringDraftResponse = await draftPATCH(
      jsonRequest(
        "/api/v1/review-cases/rc-demo-deposit-001/draft",
        {
          draft: 123
        },
        "PATCH"
      ),
      params({ caseId: "rc-demo-deposit-001" })
    );
    const nonStringDraftBody = await nonStringDraftResponse.json();

    expect(nonStringDraftResponse.status).toBe(400);
    expect(nonStringDraftBody.error.message).toContain("draft");

    const missingCaseDraftResponse = await draftPATCH(
      jsonRequest(
        "/api/v1/review-cases/missing-case/draft",
        {
          draft: "Reviewer가 직접 편집한 수정 요청 의견 초안"
        },
        "PATCH"
      ),
      params({ caseId: "missing-case" })
    );
    const missingCaseDraftBody = await missingCaseDraftResponse.json();

    expect(missingCaseDraftResponse.status).toBe(404);
    expect(missingCaseDraftBody.error.message).toContain("not found");

    const reportResponse = await reportPOST(
      jsonRequest("/api/v1/review-cases/rc-demo-deposit-001/reports/generate", {
        reportType: "change_request",
        tone: "formal",
        includeChatContext: true,
        issueIds: ["issue-deposit-rate"],
        draft: "현재 편집된 수정 요청 의견 초안"
      }),
      params({ caseId: "rc-demo-deposit-001" })
    );
    const reportBody = await reportResponse.json();

    expect(reportResponse.status).toBe(200);
    expect(reportBody).toMatchObject({
      reportId: "report-rc-demo-deposit-001-v1",
      version: 1
    });
    expect(reportBody.contentMarkdown).toContain("최고 연 5.0% 적금 홍보물 심의 리포트");
    expect(reportBody.contentMarkdown).toContain("현재 편집된 수정 요청 의견 초안");
    expect(reportBody.contentMarkdown).toContain("최고금리 조건 표시 불충분");
    expect(reportBody.evidenceIds).toEqual(["ev-deposit-product", "ev-deposit-policy"]);

    const invalidReportResponse = await reportPOST(
      jsonRequest("/api/v1/review-cases/rc-demo-deposit-001/reports/generate", {
        issueIds: ["unknown-issue"]
      }),
      params({ caseId: "rc-demo-deposit-001" })
    );
    const invalidReportBody = await invalidReportResponse.json();

    expect(invalidReportResponse.status).toBe(400);
    expect(invalidReportBody.error.message).toContain("issueIds");

    const decisionResponse = await issuePATCH(
      jsonRequest(
        "/api/v1/review-cases/rc-demo-deposit-001/issues/issue-deposit-rate",
        {
          reviewerRiskLevel: "reject_recommended",
          finalAction: "change_request",
          reviewerComment: "우대 조건 병기 필요"
        },
        "PATCH"
      ),
      params({ caseId: "rc-demo-deposit-001", issueId: "issue-deposit-rate" })
    );
    const decisionBody = await decisionResponse.json();

    expect(decisionResponse.status).toBe(200);
    expect(decisionBody.issue).toMatchObject({
      reviewerRiskLevel: "reject_recommended",
      finalAction: "change_request",
      reviewerComment: "우대 조건 병기 필요"
    });
  });

  it("updates final review status through the finalize route", async () => {
    await createPOST(
      jsonRequest("/api/v1/review-cases", { samplePackageId: "rc-demo-deposit-001" })
    );

    const updateResponse = await finalizePOST(
      jsonRequest("/api/v1/review-cases/rc-demo-deposit-001/finalize", {
        finalAction: "change_request"
      }),
      params({ caseId: "rc-demo-deposit-001" })
    );
    const updateBody = await updateResponse.json();

    expect(updateResponse.status).toBe(200);
    expect(updateBody.reviewCase).toMatchObject({
      id: "rc-demo-deposit-001",
      status: "change_requested"
    });

    const invalidResponse = await finalizePOST(
      jsonRequest("/api/v1/review-cases/rc-demo-deposit-001/finalize", {
        finalAction: "submitted"
      }),
      params({ caseId: "rc-demo-deposit-001" })
    );
    const invalidBody = await invalidResponse.json();

    expect(invalidResponse.status).toBe(400);
    expect(invalidBody.error.message).toContain("finalAction");

    const prototypeKeyResponse = await finalizePOST(
      jsonRequest("/api/v1/review-cases/rc-demo-deposit-001/finalize", {
        finalAction: "toString"
      }),
      params({ caseId: "rc-demo-deposit-001" })
    );
    const prototypeKeyBody = await prototypeKeyResponse.json();

    expect(prototypeKeyResponse.status).toBe(400);
    expect(prototypeKeyBody.error.message).toContain("finalAction");
  });
});
