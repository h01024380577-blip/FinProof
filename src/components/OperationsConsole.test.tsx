import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { RoleProvider } from "./RoleContext";
import { OperationsConsole } from "./OperationsConsole";

const reviewSummary = {
  id: "rc-demo-deposit-001",
  title: "최고 연 5.0% 적금 홍보물 심의",
  affiliate: "광주은행",
  productType: "deposit",
  plannedPublishDate: "2026-06-10",
  status: "approved",
  highestRiskLevel: "high",
  requester: "마케팅 담당자 김지현",
  reviewer: "준법심의자 박민준",
  availableActions: ["view_audit"]
};

function renderConsole() {
  return render(
    <RoleProvider initialRole="compliance_admin" initialAuthToken="admin.jwt">
      <OperationsConsole />
    </RoleProvider>
  );
}

describe("OperationsConsole", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads Product V1 knowledge documents and case library panels", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          documents: [
            {
              id: "knowledge-001",
              tenantId: "tenant-demo",
              documentType: "internal_policy",
              productType: "deposit",
              title: "예금 광고 심의 가이드",
              version: "2026.05",
              effectiveFrom: "2026-05-01",
              approvalStatus: "draft",
              storageKey: "knowledge/deposit-guide.pdf",
              createdBy: "user-admin-demo",
              createdAt: "2026-05-26T00:00:00.000Z"
            }
          ]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [reviewSummary],
          reviewCases: [reviewSummary],
          page: 1,
          pageSize: 5,
          total: 1
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    renderConsole();

    expect(await screen.findByText("운영 콘솔")).toBeInTheDocument();
    expect(screen.getByText("예금 광고 심의 가이드")).toBeInTheDocument();
    expect(screen.getByText("최고 연 5.0% 적금 홍보물 심의")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/knowledge-documents",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-finproof-role": "compliance_admin",
          authorization: "Bearer admin.jwt"
        })
      })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/case-library?page=1&pageSize=5",
      expect.any(Object)
    );
  });

  it("creates a knowledge document through the Product V1 API", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ documents: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [], reviewCases: [], page: 1, pageSize: 5, total: 0 })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          document: {
            id: "knowledge-created",
            tenantId: "tenant-demo",
            documentType: "guide",
            title: "상품 설명서 검수 기준",
            version: "v1",
            effectiveFrom: "2026-05-26",
            approvalStatus: "draft",
            storageKey: "knowledge/product-guide.md",
            createdBy: "user-admin-demo",
            createdAt: "2026-05-26T00:00:00.000Z"
          }
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    renderConsole();

    await user.type(await screen.findByLabelText("문서 제목"), "상품 설명서 검수 기준");
    await user.type(screen.getByLabelText("버전"), "v1");
    await user.type(screen.getByLabelText("저장 키"), "knowledge/product-guide.md");
    await user.selectOptions(screen.getByLabelText("문서 유형"), "guide");
    await user.click(screen.getByRole("button", { name: "문서 등록" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/v1/knowledge-documents",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("상품 설명서 검수 기준")
        })
      );
    });
    expect(await screen.findByText("상품 설명서 검수 기준")).toBeInTheDocument();
  });

  it("uses persistent chat, draft version, and persisted report endpoints", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ documents: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [], reviewCases: [], page: 1, pageSize: 5, total: 0 })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          session: {
            id: "chat-session-001",
            reviewCaseId: "rc-demo-deposit-001",
            issueId: "issue-deposit-rate",
            mode: "issue",
            userId: "user-reviewer-demo",
            createdAt: "2026-05-26T00:00:00.000Z"
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          userMessage: {
            id: "chat-message-user",
            chatSessionId: "chat-session-001",
            role: "user",
            content: "근거 요약",
            evidenceIds: [],
            markedForDraft: false,
            createdAt: "2026-05-26T00:00:00.000Z"
          },
          assistantMessage: {
            id: "chat-message-assistant",
            chatSessionId: "chat-session-001",
            role: "assistant",
            content: "우대금리 조건 병기가 필요합니다.",
            evidenceIds: ["ev-001"],
            markedForDraft: false,
            createdAt: "2026-05-26T00:00:00.000Z"
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            id: "chat-message-assistant",
            chatSessionId: "chat-session-001",
            role: "assistant",
            content: "우대금리 조건 병기가 필요합니다.",
            evidenceIds: ["ev-001"],
            markedForDraft: true,
            createdAt: "2026-05-26T00:00:00.000Z"
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          draftVersion: {
            id: "draft-001",
            reviewCaseId: "rc-demo-deposit-001",
            version: 2,
            draft: "초안",
            source: "generated",
            sourceMessageIds: ["chat-message-assistant"],
            evidenceIds: ["ev-001"],
            createdBy: "user-reviewer-demo",
            createdAt: "2026-05-26T00:00:00.000Z"
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          report: {
            id: "report-001",
            reviewCaseId: "rc-demo-deposit-001",
            reportType: "change_request",
            contentMarkdown: "# 리포트",
            evidenceIds: ["ev-001"],
            version: 1,
            createdBy: "user-reviewer-demo",
            createdAt: "2026-05-26T00:00:00.000Z"
          }
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    renderConsole();

    await user.type(await screen.findByLabelText("심의 ID"), "rc-demo-deposit-001");
    await user.type(screen.getByLabelText("이슈 ID"), "issue-deposit-rate");
    await user.click(screen.getByRole("button", { name: "세션 생성" }));
    await user.type(await screen.findByLabelText("세션 질문"), "근거 요약");
    await user.click(screen.getByRole("button", { name: "메시지 전송" }));
    await user.click(await screen.findByRole("button", { name: "초안 반영 표시" }));
    await user.click(screen.getByRole("button", { name: "초안 버전 저장" }));
    await user.click(screen.getByRole("button", { name: "리포트 저장" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/review-cases/rc-demo-deposit-001/draft/versions",
        expect.objectContaining({ method: "POST" })
      );
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/review-cases/rc-demo-deposit-001/reports",
        expect.objectContaining({ method: "POST" })
      );
    });
    expect(await screen.findByText("draft-001")).toBeInTheDocument();
    expect(await screen.findByText("report-001")).toBeInTheDocument();
  });

  it("checks analysis status, audit events, issues, and evidence for a review case", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ documents: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [], reviewCases: [], page: 1, pageSize: 5, total: 0 })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jobId: "job-001",
          status: "completed",
          progress: 100,
          currentStep: "완료",
          reviewCaseStatus: "analysis_complete"
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          issues: [
            {
              id: "issue-deposit-rate",
              issueType: "rate_disclosure",
              riskLevel: "high",
              title: "우대금리 조건 누락",
              targetText: "최고 연 5.0%",
              targetBbox: [0, 0, 1, 1],
              sourceAgents: ["regulation"],
              suggestedAction: "change_request",
              status: "open",
              description: "조건 병기 필요",
              suggestedCopy: "조건을 함께 표시하세요.",
              evidence: []
            }
          ]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          evidence: [
            {
              id: "ev-001",
              sourceType: "internal_policy",
              title: "예금 광고 심의 가이드",
              quoteSummary: "우대금리 조건을 명확히 표시해야 합니다.",
              relevanceScore: 0.94
            }
          ]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          auditEvents: [
            {
              id: "audit-001",
              tenantId: "tenant-demo",
              userId: "user-admin-demo",
              action: "draft.version.create",
              targetType: "draft_version",
              targetId: "draft-001",
              createdAt: "2026-05-26T00:00:00.000Z"
            }
          ]
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    renderConsole();

    await user.type(await screen.findByLabelText("심의 ID"), "rc-demo-deposit-001");
    await user.type(screen.getByLabelText("이슈 ID"), "issue-deposit-rate");
    await user.click(screen.getByRole("button", { name: "상태 조회" }));
    await user.click(screen.getByRole("button", { name: "이슈 조회" }));
    await user.click(screen.getByRole("button", { name: "근거 조회" }));
    await user.click(screen.getByRole("button", { name: "감사 이벤트 조회" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/review-cases/rc-demo-deposit-001/analysis/status",
        expect.any(Object)
      );
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/review-cases/rc-demo-deposit-001/issues",
        expect.any(Object)
      );
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/issues/issue-deposit-rate/evidence",
        expect.any(Object)
      );
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/review-cases/rc-demo-deposit-001/audit-events",
        expect.any(Object)
      );
    });
    expect(await screen.findByText("job-001")).toBeInTheDocument();
    expect(await screen.findByText("우대금리 조건 누락")).toBeInTheDocument();
    expect(await screen.findByText("예금 광고 심의 가이드")).toBeInTheDocument();
    expect(await screen.findByText("draft.version.create")).toBeInTheDocument();
  });
});
