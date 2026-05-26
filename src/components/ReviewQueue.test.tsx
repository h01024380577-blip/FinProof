import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { RoleProvider } from "./RoleContext";
import { ReviewQueue } from "./ReviewQueue";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
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

    const completedRow = await screen.findByRole("row", { name: /최고 연 5.0%/ });
    await user.click(completedRow);
    expect(pushMock).toHaveBeenCalledWith("/reviews/rc-demo-deposit-001");
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
});
