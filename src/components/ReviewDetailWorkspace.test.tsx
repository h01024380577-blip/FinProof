import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getReviewCaseById } from "@/domain/reviews";
import { ReviewDetailWorkspace } from "./ReviewDetailWorkspace";

describe("ReviewDetailWorkspace", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not show sample RAG answers when an uploaded case has no selected issue", () => {
    const uploadReview = {
      ...getReviewCaseById("rc-demo-deposit-001")!,
      id: "rc-upload-001",
      title: "실제 업로드 적금 홍보물",
      status: "analysis_complete" as const,
      highestRiskLevel: "info" as const,
      issues: [],
      promotionalCopy: "실제 업로드 자료 분석 대기",
      disclosure: "실제 업로드 건은 OCR/RAG 분석 전이므로 근거 부족 상태로 표시됩니다.",
      expectedDraft:
        "deposit 상품 실제 업로드 자료는 접수되었습니다. 현재 Demo MVP에서는 OCR/RAG 분석 전이므로 파일 분류와 누락 자료 확인 결과를 기준으로 추가 확인이 필요합니다.",
      analysisNotice: "실제 업로드 건은 OCR/RAG 분석 전이므로 근거 부족 상태로 표시됩니다."
    };

    render(<ReviewDetailWorkspace review={uploadReview} />);

    expect(screen.getByText("추가 확인 필요")).toBeInTheDocument();
    expect(screen.getAllByText(/OCR\/RAG 분석 전/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "질문 보내기" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "의견 초안에 반영" })).toBeDisabled();
    expect(screen.queryByText(/조건부 혜택임을/)).not.toBeInTheDocument();
  });

  it("runs selected issue chat, guards missing evidence, and saves reviewer decision", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: {
            id: "chat-insufficient",
            question: "약관에만 있는 중도해지 조건도 단정해도 되나요?",
            answerType: "insufficient_evidence",
            content: "추가 확인 필요: 약관 자료가 필요합니다.",
            evidence: [],
            requiredMaterials: ["약관"]
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: {
            id: "chat-evidence",
            question: "우대금리 조건을 어느 수준까지 표시해야 하나요?",
            answerType: "evidence_based",
            content: "현재 근거상 조건부 혜택임을 인접 고지에서 명확히 표시해야 합니다.",
            evidence: [
              {
                id: "evidence-product-rate",
                sourceType: "product_doc",
                title: "정기적금 상품설명서",
                quoteSummary: "우대금리 조건",
                relevanceScore: 0.92
              }
            ],
            requiredMaterials: []
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          draft: "채팅 반영: 우대금리 조건 병기 필요"
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          issue: {
            id: "issue-deposit-rate",
            reviewerRiskLevel: "reject_recommended",
            reviewerComment: "우대 조건 병기 필요"
          }
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<ReviewDetailWorkspace review={getReviewCaseById("rc-demo-deposit-001")!} />);

    await user.clear(screen.getByLabelText("RAG question"));
    await user.type(
      screen.getByLabelText("RAG question"),
      "약관에만 있는 중도해지 조건도 단정해도 되나요?"
    );
    await user.click(screen.getByRole("button", { name: "질문 보내기" }));

    expect(await screen.findByText(/추가 확인 필요/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/review-cases/rc-demo-deposit-001/chat",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          issueId: "issue-deposit-rate",
          question: "약관에만 있는 중도해지 조건도 단정해도 되나요?"
        })
      })
    );

    await user.clear(screen.getByLabelText("RAG question"));
    await user.type(
      screen.getByLabelText("RAG question"),
      "우대금리 조건을 어느 수준까지 표시해야 하나요?"
    );
    await user.click(screen.getByRole("button", { name: "질문 보내기" }));
    expect(await screen.findByText(/조건부 혜택임을/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "의견 초안에 반영" }));
    await user.click(screen.getByRole("button", { name: "수정 요청 의견 초안 생성" }));

    expect(await screen.findByDisplayValue(/채팅 반영/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/review-cases/rc-demo-deposit-001/draft",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("chat-evidence")
      })
    );

    await user.selectOptions(screen.getByLabelText("Reviewer risk level"), "reject_recommended");
    await user.type(screen.getByLabelText("Reviewer comment"), "우대 조건 병기 필요");
    await user.click(screen.getByRole("button", { name: "판단 저장" }));

    expect(await screen.findByText("저장된 판단: 반려 권고")).toBeInTheDocument();
    expect(screen.getByText("저장된 판단: 반려 권고").closest(".saved-decision")).toHaveTextContent(
      "우대 조건 병기 필요"
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/review-cases/rc-demo-deposit-001/issues/issue-deposit-rate",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          reviewerRiskLevel: "reject_recommended",
          finalAction: "change_request",
          reviewerComment: "우대 조건 병기 필요"
        })
      })
    );
  });

  it("scopes chat responses and marked draft context to the selected issue", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: {
            id: "chat-first-issue",
            question: "우대금리 조건을 어느 수준까지 표시해야 하나요?",
            answerType: "evidence_based",
            content: "첫 번째 이슈 전용 답변입니다.",
            evidence: [
              {
                id: "evidence-product-rate",
                sourceType: "product_doc",
                title: "정기적금 상품설명서",
                quoteSummary: "우대금리 조건",
                relevanceScore: 0.92
              }
            ],
            requiredMaterials: []
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          draft: "선택 이슈에 표시된 근거만 반영"
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<ReviewDetailWorkspace review={getReviewCaseById("rc-demo-deposit-001")!} />);

    await user.click(screen.getByRole("button", { name: "질문 보내기" }));
    expect(await screen.findByText("첫 번째 이슈 전용 답변입니다.")).toBeInTheDocument();

    await user.click(screen.getByText("조건부 혜택의 무조건 표현"));

    expect(screen.queryByText("첫 번째 이슈 전용 답변입니다.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "의견 초안에 반영" }));
    await user.click(screen.getByRole("button", { name: "수정 요청 의견 초안 생성" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/review-cases/rc-demo-deposit-001/draft",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ markedResponses: [] })
      })
    );
  });

  it("uses the selected issue suggested action when saving reviewer decision", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        issue: {
          id: "issue-loan-anyone",
          reviewerRiskLevel: "reject_recommended",
          finalAction: "reject",
          reviewerComment: "승인 속도 표현 반려 필요"
        }
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ReviewDetailWorkspace review={getReviewCaseById("rc-demo-loan-001")!} />);

    await user.type(screen.getByLabelText("Reviewer comment"), "승인 속도 표현 반려 필요");
    await user.click(screen.getByRole("button", { name: "판단 저장" }));

    expect(await screen.findByText("저장된 판단: 반려 권고")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/review-cases/rc-demo-loan-001/issues/issue-loan-anyone",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          reviewerRiskLevel: "reject_recommended",
          finalAction: "reject",
          reviewerComment: "승인 속도 표현 반려 필요"
        })
      })
    );
  });

  it("does not show a stale saved decision after switching issues during save", async () => {
    const user = userEvent.setup();
    let resolvePatch!: (value: unknown) => void;
    const patchPromise = new Promise((resolve) => {
      resolvePatch = resolve;
    });
    const fetchMock = vi.fn().mockReturnValueOnce(patchPromise);
    vi.stubGlobal("fetch", fetchMock);

    render(<ReviewDetailWorkspace review={getReviewCaseById("rc-demo-deposit-001")!} />);

    await user.type(screen.getByLabelText("Reviewer comment"), "우대 조건 병기 필요");
    await user.click(screen.getByRole("button", { name: "판단 저장" }));
    expect(screen.getByRole("button", { name: "저장 중" })).toBeDisabled();

    await user.click(screen.getByText("조건부 혜택의 무조건 표현"));
    resolvePatch({
      ok: true,
      json: async () => ({
        issue: {
          id: "issue-deposit-rate",
          reviewerRiskLevel: "high",
          reviewerComment: "우대 조건 병기 필요"
        }
      })
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "판단 저장" })).toBeEnabled();
    });
    expect(screen.queryByText(/저장된 판단/)).not.toBeInTheDocument();
  });
});
