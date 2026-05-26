import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { RoleProvider } from "./RoleContext";
import { ReviewQueue } from "./ReviewQueue";

const pushMock = vi.fn();
let currentSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useSearchParams: () => currentSearchParams,
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn()
  })
}));

const reviewSummaries = [
  {
    id: "rc-demo-deposit-001",
    title: "최고 연 5.0% 적금 홍보물 심의",
    affiliate: "광주은행",
    productType: "deposit",
    plannedPublishDate: "2026-06-10",
    status: "analysis_complete",
    highestRiskLevel: "high",
    requester: "마케팅 담당자 김지현",
    reviewer: "준법심의자 박민준",
    availableActions: ["open_workbench", "view_audit"]
  },
  {
    id: "rc-upload-001",
    title: "실제 업로드 적금 홍보물",
    affiliate: "광주은행",
    productType: "deposit",
    plannedPublishDate: "2026-06-20",
    status: "analysis_waiting",
    highestRiskLevel: "info",
    requester: "업로드 요청자",
    reviewer: "준법심의자 박민준",
    availableActions: ["start_analysis"]
  }
];

const completedReviewSummary = {
  id: "rc-history-approved-001",
  title: "승인 완료된 정기예금 홍보물",
  affiliate: "광주은행",
  productType: "deposit",
  plannedPublishDate: "2026-06-01",
  status: "approved",
  highestRiskLevel: "info",
  requester: "마케팅 담당자 이서연",
  reviewer: "준법심의자 박민준",
  availableActions: ["view_audit"]
};

const rejectedReviewSummary = {
  id: "rc-history-rejected-001",
  title: "반려 완료된 신용대출 홍보물",
  affiliate: "광주은행",
  productType: "loan",
  plannedPublishDate: "2026-06-02",
  status: "rejected",
  highestRiskLevel: "reject_recommended",
  requester: "마케팅 담당자 최도윤",
  reviewer: "준법심의자 박민준",
  availableActions: ["view_audit"]
};

const changeRequestedReviewSummary = {
  id: "rc-change-requested-001",
  title: "수정 요청 진행 중인 카드 홍보물",
  affiliate: "광주은행",
  productType: "card",
  plannedPublishDate: "2026-06-08",
  status: "change_requested",
  highestRiskLevel: "caution",
  requester: "마케팅 담당자 정하린",
  reviewer: "준법심의자 박민준",
  availableActions: ["view_audit"]
};

const requesterReviewSummaries = reviewSummaries.map((review) =>
  review.id === "rc-upload-001" ? { ...review, availableActions: [] } : review
);

const depositReview = {
  ...reviewSummaries[0],
  channelType: ["poster", "sns"],
  promotionalCopy: "최고 연 5.0% 적금\n지금 가입하면 누구나 최고금리 혜택!",
  disclosure: "우대금리는 조건 충족 시 적용됩니다.",
  productDescription: "상품 설명서",
  missingMaterials: ["terms"],
  files: [],
  expectedDraft: "수정 요청 의견 초안",
  issues: [
    {
      id: "issue-deposit-rate",
      issueType: "RATE_DISPLAY_RISK",
      riskLevel: "high",
      title: "최고금리 조건 표시 불충분",
      targetText: "최고 연 5.0%",
      targetBbox: [10, 10, 30, 10],
      sourceAgents: ["product_terms_agent"],
      suggestedAction: "change_request",
      status: "open",
      description: "기본금리와 우대금리 조건이 충분히 구분되지 않습니다.",
      suggestedCopy: "조건 충족 시 최고 연 5.0%",
      evidence: [
        {
          id: "ev-001",
          sourceType: "product_doc",
          title: "정기적금 상품설명서",
          page: 3,
          section: "우대금리 조건",
          quoteSummary: "우대 조건 충족 시 최고금리 적용",
          relevanceScore: 0.9
        }
      ]
    }
  ]
};

function renderQueue(
  initialRole: "requester" | "reviewer" | "compliance_admin" = "reviewer",
  initialAuthToken = ""
) {
  return render(
    <RoleProvider initialRole={initialRole} initialAuthToken={initialAuthToken}>
      <ReviewQueue />
    </RoleProvider>
  );
}

describe("ReviewQueue", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockReset();
    currentSearchParams = new URLSearchParams();
  });

  it("shows compliance queue controls and navigates completed cases to the workbench route", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ reviewCases: reviewSummaries })
    });
    vi.stubGlobal("fetch", fetchMock);

    renderQueue("reviewer");

    expect(await screen.findByText("심의 큐")).toBeInTheDocument();
    expect(screen.getAllByText("분석 대기").length).toBeGreaterThan(0);
    expect(screen.getAllByText("검토 중").length).toBeGreaterThan(0);
    expect(screen.getAllByText("반려 권고").length).toBeGreaterThan(0);
    expect(screen.getByText("마감 임박")).toBeInTheDocument();
    expect(screen.getByLabelText("검색")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "위험도" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "마감일" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "새 심의 요청" })).not.toBeInTheDocument();

    const completedRow = await screen.findByRole("row", { name: /최고 연 5.0%/ });
    await user.click(completedRow);
    expect(pushMock).toHaveBeenCalledWith("/reviews/rc-demo-deposit-001");
  });

  it("keeps finalized reviews out of the active queue", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        reviewCases: [...reviewSummaries, completedReviewSummary, changeRequestedReviewSummary]
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    renderQueue("reviewer");

    expect(await screen.findByText("실제 업로드 적금 홍보물")).toBeInTheDocument();
    expect(screen.getByText("수정 요청 진행 중인 카드 홍보물")).toBeInTheDocument();
    expect(screen.queryByText("승인 완료된 정기예금 홍보물")).not.toBeInTheDocument();
  });

  it("shows all finalized review history by default with decision-specific history filters", async () => {
    currentSearchParams = new URLSearchParams("scope=history");
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        reviewCases: [
          ...reviewSummaries,
          completedReviewSummary,
          rejectedReviewSummary,
          changeRequestedReviewSummary
        ]
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    renderQueue("reviewer");

    expect(await screen.findByText("심의 이력")).toBeInTheDocument();
    expect(screen.queryByLabelText("Review queue metrics")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "마감 임박 필터 적용" })).not.toBeInTheDocument();

    const historyTabs = screen.getByRole("tablist", { name: "심의 이력 구분" });
    expect(within(historyTabs).getByRole("tab", { name: "승인 완료" })).toHaveAttribute(
      "aria-selected",
      "false"
    );
    expect(within(historyTabs).getByRole("tab", { name: "반려 완료" })).toHaveAttribute(
      "aria-selected",
      "false"
    );
    expect(
      within(within(historyTabs).getByRole("tab", { name: "승인 완료" })).getByText("1")
    ).toBeInTheDocument();
    expect(
      within(within(historyTabs).getByRole("tab", { name: "반려 완료" })).getByText("1")
    ).toBeInTheDocument();
    expect(screen.getByText("승인 완료된 정기예금 홍보물")).toBeInTheDocument();
    expect(screen.getByText("반려 완료된 신용대출 홍보물")).toBeInTheDocument();
    expect(screen.queryByText("수정 요청 진행 중인 카드 홍보물")).not.toBeInTheDocument();
    expect(screen.queryByText("최고 연 5.0% 적금 홍보물 심의")).not.toBeInTheDocument();
    expect(screen.queryByText("실제 업로드 적금 홍보물")).not.toBeInTheDocument();

    const statusFilter = screen.getByLabelText("상태");
    expect(
      within(statusFilter)
        .getAllByRole("option")
        .map((option) => option.textContent)
    ).toEqual(["전체", "승인", "반려"]);
    expect(statusFilter).toHaveValue("all");
  });

  it("switches review history between approved and rejected decisions", async () => {
    const user = userEvent.setup();
    currentSearchParams = new URLSearchParams("scope=history");
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        reviewCases: [...reviewSummaries, completedReviewSummary, rejectedReviewSummary]
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    renderQueue("reviewer");

    expect(await screen.findByText("승인 완료된 정기예금 홍보물")).toBeInTheDocument();
    expect(screen.getByText("반려 완료된 신용대출 홍보물")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("상태"), "rejected");

    expect(screen.getByRole("tab", { name: "승인 완료" })).toHaveAttribute(
      "aria-selected",
      "false"
    );
    expect(screen.getByRole("tab", { name: "반려 완료" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("반려 완료된 신용대출 홍보물")).toBeInTheDocument();
    expect(screen.queryByText("승인 완료된 정기예금 홍보물")).not.toBeInTheDocument();
  });

  it("gates analysis start to reviewer roles", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ reviewCases: requesterReviewSummaries })
    });
    vi.stubGlobal("fetch", fetchMock);

    renderQueue("requester", "requester.jwt");

    const uploadRow = await screen.findByRole("row", { name: /실제 업로드 적금 홍보물/ });
    const requesterAction = within(uploadRow).getByRole("button", { name: "AI 분석 시작" });

    expect(requesterAction).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/review-cases",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-finproof-role": "requester",
          authorization: "Bearer requester.jwt"
        })
      })
    );
  });

  it("starts analysis from a waiting row and exposes the completed workbench navigation", async () => {
    const user = userEvent.setup();
    const analyzedUploadReview = {
      ...depositReview,
      id: "rc-upload-001",
      title: "실제 업로드 적금 홍보물",
      status: "analysis_complete"
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ reviewCases: reviewSummaries })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          reviewCaseId: "rc-upload-001",
          status: "analysis_complete",
          issueCount: 1,
          analysisHref: "/reviews/rc-upload-001"
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ reviewCase: analyzedUploadReview })
      });
    vi.stubGlobal("fetch", fetchMock);

    renderQueue("reviewer", "reviewer.jwt");

    const uploadRow = await screen.findByRole("row", { name: /실제 업로드 적금 홍보물/ });
    await user.click(within(uploadRow).getByRole("button", { name: "AI 분석 시작" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/review-cases/rc-upload-001/analysis/start",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "x-finproof-role": "reviewer",
            authorization: "Bearer reviewer.jwt"
          })
        })
      );
    });

    const updatedRow = await screen.findByRole("row", { name: /실제 업로드 적금 홍보물/ });
    await user.click(updatedRow);
    expect(pushMock).toHaveBeenCalledWith("/reviews/rc-upload-001");
  });

  it("uses backend pagination when the reviewer moves through queue pages", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ reviewCases: reviewSummaries, page: 1, pageSize: 10, total: 22 })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          reviewCases: [completedReviewSummary],
          page: 2,
          pageSize: 10,
          total: 22
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    renderQueue("reviewer");

    expect(await screen.findByText("1 / 3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "다음 페이지" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/v1/review-cases?page=2&pageSize=10",
        expect.any(Object)
      );
    });
    expect(await screen.findByText("2 / 3")).toBeInTheDocument();
  });
});
