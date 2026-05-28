import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { RoleProvider } from "./RoleContext";
import { ReviewDetailLoader } from "./ReviewDetailLoader";

vi.mock("./ReviewDetailWorkspace", () => ({
  ReviewDetailWorkspace: ({ review }: { review: { title: string } }) => (
    <section aria-label="loaded-workbench">{review.title}</section>
  )
}));

describe("ReviewDetailLoader", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a spinning loader while the review case is loading", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));

    render(
      <RoleProvider>
        <ReviewDetailLoader reviewId="rc-upload-001" />
      </RoleProvider>
    );

    const loadingMessage = screen.getByText("심의 건을 불러오는 중입니다.");
    expect(
      loadingMessage.closest(".queue-empty-state")?.querySelector(".action-spinner")
    ).toBeInTheDocument();
  });

  it("loads a real review case through the API with bearer authorization", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        reviewCase: {
          id: "rc-upload-001",
          title: "실제 업로드 적금 홍보물",
          affiliate: "광주은행",
          productType: "deposit",
          channelType: ["mobile_app"],
          plannedPublishDate: "2026-06-20",
          status: "analysis_complete",
          highestRiskLevel: "high",
          requester: "업로드 요청자",
          reviewer: "준법심의자 박민준",
          promotionalCopy: "최고 연 5.0%",
          disclosure: "",
          productDescription: "",
          missingMaterials: [],
          files: [],
          issues: [],
          expectedDraft: "검토 의견 초안"
        }
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <RoleProvider initialAuthToken="reviewer.jwt">
        <ReviewDetailLoader reviewId="rc-upload-001" />
      </RoleProvider>
    );

    expect(await screen.findByLabelText("loaded-workbench")).toHaveTextContent(
      "실제 업로드 적금 홍보물"
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/review-cases/rc-upload-001",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-finproof-role": "reviewer",
          authorization: "Bearer reviewer.jwt"
        })
      })
    );
  });
});
