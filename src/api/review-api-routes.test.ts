// @vitest-environment node

import type { ReviewChatResponse } from "@/domain/chat";
import { resetDefaultReviewStoreForTests } from "@/server/reviews";
import { POST as chatPOST } from "@/app/api/v1/review-cases/[caseId]/chat/route";
import { POST as draftPOST } from "@/app/api/v1/review-cases/[caseId]/draft/route";
import { GET as detailGET } from "@/app/api/v1/review-cases/[caseId]/route";
import { POST as analysisPOST } from "@/app/api/v1/review-cases/[caseId]/analysis/start/route";
import { POST as finalizePOST } from "@/app/api/v1/review-cases/[caseId]/finalize/route";
import { POST as reportPOST } from "@/app/api/v1/review-cases/[caseId]/reports/generate/route";
import { GET as issuesGET } from "@/app/api/v1/review-cases/[caseId]/issues/route";
import { PATCH as issuePATCH } from "@/app/api/v1/review-cases/[caseId]/issues/[issueId]/route";
import { GET as listGET, POST as createPOST } from "@/app/api/v1/review-cases/route";
import { GET as evidenceGET } from "@/app/api/v1/issues/[issueId]/evidence/route";
import { GET as samplePackageGET } from "@/app/api/v1/sample-packages/[samplePackageId]/route";
import { GET as samplePackagesGET } from "@/app/api/v1/sample-packages/route";

function jsonRequest(path: string, body: unknown, method = "POST") {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function params<T extends Record<string, string>>(value: T) {
  return { params: Promise.resolve(value) };
}

describe("review API routes", () => {
  beforeEach(() => {
    resetDefaultReviewStoreForTests();
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
      status: "submitted"
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
      issueCount: 3
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
      status: "submitted",
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
      issueCount: 0,
      analysisNotice: "실제 업로드 건은 OCR/RAG 분석 전이므로 근거 부족 상태로 표시됩니다."
    });
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
        markedResponses: [evidenceChatBody.response]
      }),
      params({ caseId: "rc-demo-deposit-001" })
    );
    const draftBody = await draftResponse.json();

    expect(draftResponse.status).toBe(200);
    expect(draftBody.draft).toContain("채팅 반영");

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
