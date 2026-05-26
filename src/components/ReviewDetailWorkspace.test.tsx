import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { getReviewCaseById } from "@/domain/reviews";
import { ReviewDetailWorkspace } from "./ReviewDetailWorkspace";
import { RoleProvider } from "./RoleContext";

let currentSearchParams = new URLSearchParams();
const replaceMock = vi.fn((href: string) => {
  const queryIndex = href.indexOf("?");
  currentSearchParams = new URLSearchParams(queryIndex >= 0 ? href.slice(queryIndex + 1) : "");
});
const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn()
  }),
  useSearchParams: () => currentSearchParams,
  usePathname: () => "/reviews/test-id"
}));

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

function restoreUrlFunction(
  name: "createObjectURL" | "revokeObjectURL",
  value: typeof URL.createObjectURL | typeof URL.revokeObjectURL | undefined
) {
  if (value) {
    Object.defineProperty(URL, name, { configurable: true, value });
    return;
  }

  Reflect.deleteProperty(URL, name);
}

async function openOpinionTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("tab", { name: "의견서" }));
}

async function openDraftTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("tab", { name: "의견 초안" }));
}

function changeTextField(label: string, value: string) {
  const field = screen.getByLabelText(label);
  fireEvent.change(field, { target: { value } });
  expect(field).toHaveValue(value);
  return field;
}

describe("ReviewDetailWorkspace", () => {
  beforeEach(() => {
    replaceMock.mockClear();
    pushMock.mockClear();
    currentSearchParams = new URLSearchParams();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    restoreUrlFunction("createObjectURL", originalCreateObjectURL);
    restoreUrlFunction("revokeObjectURL", originalRevokeObjectURL);
  });

  it("renders the reference-style three-pane compliance workbench", async () => {
    const user = userEvent.setup();
    render(<ReviewDetailWorkspace review={getReviewCaseById("rc-demo-deposit-001")!} />);

    expect(
      screen.getByRole("heading", { name: "최고 연 5.0% 적금 홍보물 심의" })
    ).toBeInTheDocument();
    expect(screen.getByText("이슈 목록 (3)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "보류" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "반려" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "수정 요청" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "초안 생성" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "체크리스트" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "근거 자료" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "의견서" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "근거 채팅" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "초안에 반영" })).toBeInTheDocument();

    await openOpinionTab(user);

    expect(screen.getByLabelText("심의자 메모")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "위험도 변경" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "검토 완료" })).toBeDisabled();
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
    expect(screen.getByRole("button", { name: "초안에 반영" })).toBeDisabled();
    expect(screen.queryByText(/조건부 혜택임을/)).not.toBeInTheDocument();
  });

  it("starts chat with an empty input placeholder instead of a hardcoded example answer", () => {
    const { container } = render(
      <ReviewDetailWorkspace review={getReviewCaseById("rc-demo-deposit-001")!} />
    );
    const chatThread = container.querySelector(".chat-thread");
    const chatComposer = container.querySelector(".chat-composer");

    expect(screen.getByLabelText("RAG question")).toHaveValue("");
    expect(
      screen.getByPlaceholderText("예: 최고금리 조건을 승인 가능하게 표시하려면?")
    ).toBeInTheDocument();
    expect(screen.getByText("선택된 이슈의 근거를 기준으로 답변합니다.")).toBeInTheDocument();
    expect(screen.queryByText(/현재 근거상 조건부 혜택임을/)).not.toBeInTheDocument();
    expect(chatThread?.compareDocumentPosition(chatComposer as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it("does not render the audit log drawer tab", () => {
    render(
      <RoleProvider initialRole="reviewer">
        <ReviewDetailWorkspace review={getReviewCaseById("rc-demo-deposit-001")!} />
      </RoleProvider>
    );

    expect(screen.queryByRole("tab", { name: "감사 로그" })).not.toBeInTheDocument();
  });

  it("disables reviewer-only workbench controls for requesters", async () => {
    const user = userEvent.setup();
    const review = getReviewCaseById("rc-demo-deposit-001")!;

    render(
      <RoleProvider initialRole="requester">
        <ReviewDetailWorkspace
          review={{
            ...review,
            issues: review.issues.map((issue, index) =>
              index === 0
                ? {
                    ...issue,
                    reviewerRiskLevel: "high",
                    finalAction: "change_request",
                    reviewerComment: "이미 저장된 심의자 판단"
                  }
                : issue
            )
          }}
        />
      </RoleProvider>
    );

    // Drawer starts collapsed for requesters — expand it.
    await user.click(screen.getByRole("button", { name: /드로어 펼치기/ }));
    await openOpinionTab(user);

    expect(screen.getByLabelText("심의자 위험도")).toBeDisabled();
    expect(screen.getByLabelText("심의자 메모")).toBeDisabled();
    expect(screen.getByRole("button", { name: "위험도 변경" })).toBeDisabled();
    await openDraftTab(user);
    expect(screen.getByRole("button", { name: "의견 초안 저장" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "리포트 다운로드" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "초안 생성" })).toBeDisabled();
    await openOpinionTab(user);
    expect(screen.getByRole("button", { name: "검토 완료" })).toBeDisabled();
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

    changeTextField("RAG question", "약관에만 있는 중도해지 조건도 단정해도 되나요?");
    await user.click(screen.getByRole("button", { name: "질문 보내기" }));

    expect(await screen.findByText(/추가 확인 필요/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/review-cases/rc-demo-deposit-001/chat",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          issueId: "issue-deposit-rate",
          question: "약관에만 있는 중도해지 조건도 단정해도 되나요?",
          history: []
        })
      })
    );

    changeTextField("RAG question", "우대금리 조건을 어느 수준까지 표시해야 하나요?");
    await user.click(screen.getByRole("button", { name: "질문 보내기" }));
    expect(await screen.findByText(/조건부 혜택임을/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/review-cases/rc-demo-deposit-001/chat",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          issueId: "issue-deposit-rate",
          question: "우대금리 조건을 어느 수준까지 표시해야 하나요?",
          history: [
            {
              question: "약관에만 있는 중도해지 조건도 단정해도 되나요?",
              answer: "추가 확인 필요: 약관 자료가 필요합니다."
            }
          ]
        })
      })
    );
    await user.click(screen.getByRole("button", { name: "초안에 반영" }));
    await user.click(screen.getByRole("button", { name: "초안 생성" }));

    await openDraftTab(user);
    expect(await screen.findByDisplayValue(/채팅 반영/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/review-cases/rc-demo-deposit-001/draft",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("chat-evidence")
      })
    );

    await openOpinionTab(user);
    await user.selectOptions(screen.getByLabelText("심의자 위험도"), "reject_recommended");
    changeTextField("심의자 메모", "우대 조건 병기 필요");
    await user.click(screen.getByRole("button", { name: "위험도 변경" }));

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

  it("shows a loading chat bubble while a long answer is being generated", async () => {
    const user = userEvent.setup();
    let resolveChat!: (value: unknown) => void;
    const chatPromise = new Promise((resolve) => {
      resolveChat = resolve;
    });
    const fetchMock = vi.fn().mockReturnValueOnce(chatPromise);
    vi.stubGlobal("fetch", fetchMock);

    render(<ReviewDetailWorkspace review={getReviewCaseById("rc-demo-deposit-001")!} />);

    changeTextField("RAG question", "승인 가능한 문구로 바꿔줘");
    await user.click(screen.getByRole("button", { name: "질문 보내기" }));

    expect(screen.getByText("승인 가능한 문구로 바꿔줘")).toBeInTheDocument();
    expect(screen.getByText("답변 생성 중")).toBeInTheDocument();

    resolveChat({
      ok: true,
      json: async () => ({
        response: {
          id: "chat-loaded",
          question: "승인 가능한 문구로 바꿔줘",
          answerType: "evidence_based",
          content: "조건 충족 시 최고 연 5.0%로 수정하세요.",
          evidence: [],
          requiredMaterials: []
        }
      })
    });

    expect(await screen.findByText("조건 충족 시 최고 연 5.0%로 수정하세요.")).toBeInTheDocument();
    expect(screen.queryByText("답변 생성 중")).not.toBeInTheDocument();
  });

  it("renders long model answers as readable paragraphs and lists", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        response: {
          id: "chat-markdown",
          question: "어떤 조건을 써야 하나요?",
          answerType: "evidence_based",
          content:
            "**승인 가능 문구**는 조건을 같이 써야 합니다.\n\n- 기본금리 연 2.0%\n- 우대조건 충족 시 최고 연 5.0%\n- 세전 기준",
          evidence: [],
          requiredMaterials: []
        }
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ReviewDetailWorkspace review={getReviewCaseById("rc-demo-deposit-001")!} />);

    changeTextField("RAG question", "어떤 조건을 써야 하나요?");
    await user.click(screen.getByRole("button", { name: "질문 보내기" }));

    expect(await screen.findByText("승인 가능 문구")).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "기본금리 연 2.0%" })).toBeInTheDocument();
    expect(
      screen.getByRole("listitem", { name: "우대조건 충족 시 최고 연 5.0%" })
    ).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "세전 기준" })).toBeInTheDocument();
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

    changeTextField("RAG question", "첫 번째 이슈 질문");
    await user.click(screen.getByRole("button", { name: "질문 보내기" }));
    expect(await screen.findByText("첫 번째 이슈 전용 답변입니다.")).toBeInTheDocument();

    await user.click(screen.getByText("조건부 혜택의 무조건 표현"));

    expect(screen.queryByText("첫 번째 이슈 전용 답변입니다.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "초안에 반영" }));
    await user.click(screen.getByRole("button", { name: "초안 생성" }));

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

    await openOpinionTab(user);
    changeTextField("심의자 메모", "승인 속도 표현 반려 필요");
    await user.click(screen.getByRole("button", { name: "위험도 변경" }));

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

  it("uses the reviewer-selected header action when saving reviewer decision", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        issue: {
          id: "issue-deposit-rate",
          reviewerRiskLevel: "high",
          finalAction: "reject",
          reviewerComment: "핵심 조건 누락으로 반려"
        }
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ReviewDetailWorkspace review={getReviewCaseById("rc-demo-deposit-001")!} />);

    await user.click(screen.getByRole("button", { name: "반려" }));
    await openOpinionTab(user);
    changeTextField("심의자 메모", "핵심 조건 누락으로 반려");
    await user.click(screen.getByRole("button", { name: "위험도 변경" }));

    expect(await screen.findByText("저장된 판단: 위험")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/review-cases/rc-demo-deposit-001/issues/issue-deposit-rate",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          reviewerRiskLevel: "high",
          finalAction: "reject",
          reviewerComment: "핵심 조건 누락으로 반려"
        })
      })
    );
  });

  it("finalizes the review case status after reviewer decision is saved", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          issue: {
            id: "issue-deposit-rate",
            reviewerRiskLevel: "reject_recommended",
            finalAction: "change_request",
            reviewerComment: "우대 조건 병기 필요"
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          reviewCase: {
            id: "rc-demo-deposit-001",
            status: "change_requested"
          }
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<ReviewDetailWorkspace review={getReviewCaseById("rc-demo-deposit-001")!} />);

    await openOpinionTab(user);
    expect(screen.getByRole("button", { name: "검토 완료" })).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("심의자 위험도"), "reject_recommended");
    changeTextField("심의자 메모", "우대 조건 병기 필요");
    await user.click(screen.getByRole("button", { name: "위험도 변경" }));
    expect(await screen.findByText("저장된 판단: 반려 권고")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "검토 완료" }));

    expect(await screen.findByText("수정 요청")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/review-cases/rc-demo-deposit-001/finalize",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ finalAction: "change_request" })
      })
    );
  });

  it("downloads the generated markdown report for the selected issue", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => "blob:finproof-report");
    const revokeObjectURL = vi.fn();
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        reportId: "report-rc-demo-deposit-001-v1",
        contentMarkdown: "# 최고 연 5.0% 적금 홍보물 심의 리포트\n\n저장된 수정 요청 의견 초안",
        evidenceIds: ["ev-deposit-product", "ev-deposit-policy"],
        version: 1
      })
    });

    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    vi.stubGlobal("fetch", fetchMock);

    const review = getReviewCaseById("rc-demo-deposit-001")!;

    render(
      <ReviewDetailWorkspace
        review={{
          ...review,
          currentDraft: "저장된 수정 요청 의견 초안",
          issues: review.issues.map((issue, index) => {
            if (index === 0) {
              return {
                ...issue,
                reviewerRiskLevel: "high",
                finalAction: "change_request",
                reviewerComment: "선택 이슈 수정 요청"
              };
            }

            if (index === 1) {
              return {
                ...issue,
                reviewerRiskLevel: "reject_recommended",
                finalAction: "reject",
                reviewerComment: "다른 이슈 반려"
              };
            }

            return issue;
          })
        }}
      />
    );

    await openDraftTab(user);
    changeTextField("Opinion draft", "현재 편집된 수정 요청 의견 초안");
    await user.click(screen.getByRole("button", { name: "리포트 다운로드" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/review-cases/rc-demo-deposit-001/reports/generate",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            reportType: "change_request",
            tone: "formal",
            includeChatContext: true,
            issueIds: ["issue-deposit-rate"],
            draft: "현재 편집된 수정 요청 의견 초안"
          })
        })
      );
    });
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(anchorClick).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:finproof-report");
    expect(await screen.findByText("Markdown 리포트 다운로드를 준비했습니다.")).toBeInTheDocument();
  });

  it("saves the reviewer-edited opinion draft as a version", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        draft: "Reviewer가 직접 편집한 수정 요청 의견 초안",
        version: 2
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ReviewDetailWorkspace
        review={{
          ...getReviewCaseById("rc-demo-deposit-001")!,
          currentDraft: "저장된 수정 요청 의견 초안",
          currentDraftVersion: 1
        }}
      />
    );

    await openDraftTab(user);
    changeTextField("Opinion draft", "  Reviewer가 직접 편집한 수정 요청 의견 초안  ");
    await user.click(screen.getByRole("button", { name: "의견 초안 저장" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/review-cases/rc-demo-deposit-001/draft",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            draft: "Reviewer가 직접 편집한 수정 요청 의견 초안"
          })
        })
      );
    });
    expect(await screen.findByText("의견 초안 v2 저장됨.")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByLabelText("Opinion draft")).toHaveValue(
      "Reviewer가 직접 편집한 수정 요청 의견 초안"
    );

    changeTextField(
      "Opinion draft",
      "Reviewer가 직접 편집한 수정 요청 의견 초안 미저장 변경"
    );

    expect(screen.queryByText("의견 초안 v2 저장됨.")).not.toBeInTheDocument();
  });

  it("does not overwrite newer local draft edits when a save response resolves", async () => {
    const user = userEvent.setup();
    let resolvePatch!: (value: unknown) => void;
    const patchPromise = new Promise((resolve) => {
      resolvePatch = resolve;
    });
    const fetchMock = vi.fn().mockReturnValueOnce(patchPromise);
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ReviewDetailWorkspace
        review={{
          ...getReviewCaseById("rc-demo-deposit-001")!,
          currentDraft: "저장된 수정 요청 의견 초안",
          currentDraftVersion: 1
        }}
      />
    );

    await openDraftTab(user);
    changeTextField("Opinion draft", "저장 요청 초안");
    await user.click(screen.getByRole("button", { name: "의견 초안 저장" }));
    const draftEditor = changeTextField("Opinion draft", "저장 요청 초안 응답 전 추가 편집");

    resolvePatch({
      ok: true,
      json: async () => ({
        draft: "저장 요청 초안",
        version: 2
      })
    });

    await waitFor(() => {
      expect(screen.getByText("v2")).toBeInTheDocument();
    });
    expect(draftEditor).toHaveValue("저장 요청 초안 응답 전 추가 편집");
    expect(screen.queryByText("의견 초안 v2 저장됨.")).not.toBeInTheDocument();
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

    await openOpinionTab(user);
    changeTextField("심의자 메모", "우대 조건 병기 필요");
    await user.click(screen.getByRole("button", { name: "위험도 변경" }));
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
      expect(screen.getByRole("button", { name: "위험도 변경" })).toBeEnabled();
    });
    expect(screen.queryByText(/저장된 판단/)).not.toBeInTheDocument();
  });
});

describe("ReviewDetailWorkspace tab URL sync", () => {
  beforeEach(() => {
    replaceMock.mockClear();
    currentSearchParams = new URLSearchParams();
  });

  it("calls router.replace with ?tab=evidence when 근거 자료 tab is clicked", async () => {
    const user = userEvent.setup();
    render(<ReviewDetailWorkspace review={getReviewCaseById("rc-demo-deposit-001")!} />);

    await user.click(screen.getByRole("tab", { name: "근거 자료" }));

    expect(replaceMock).toHaveBeenCalledWith("/reviews/test-id?tab=evidence");
  });

  it("removes the tab query when returning to checklist", async () => {
    const user = userEvent.setup();
    currentSearchParams = new URLSearchParams("tab=opinion");
    render(<ReviewDetailWorkspace review={getReviewCaseById("rc-demo-deposit-001")!} />);

    await user.click(screen.getByRole("tab", { name: "체크리스트" }));

    expect(replaceMock).toHaveBeenCalledWith("/reviews/test-id");
  });
});
