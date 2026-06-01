import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RegulatoryWatchDashboard } from "./RegulatoryWatchDashboard";

describe("RegulatoryWatchDashboard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows source health and recent change sets", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            sources: [
              {
                id: "reg-source-001",
                tenantId: "tenant-demo",
                sourceType: "internal_policy_repo",
                name: "예금 광고 내부 기준",
                pollingSchedule: "0 9 * * *",
                trustLevel: "internal",
                status: "active",
                lastCheckedAt: "2026-05-31T00:00:00.000Z",
                createdAt: "2026-05-30T00:00:00.000Z",
                updatedAt: "2026-05-31T00:00:00.000Z"
              }
            ]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            changeSets: [
              {
                id: "reg-change-001",
                tenantId: "tenant-demo",
                sourceId: "reg-source-001",
                newSnapshotId: "reg-snapshot-001",
                changeType: "amended",
                changeSummary: "최고금리 표시 기준이 강화되었습니다.",
                changedSections: [],
                riskImpactLevel: "high",
                interpretationSummary: "최고금리 조건 병기 기준 강화",
                mappedProductTypes: ["deposit"],
                mappedChannels: ["mobile_banner"],
                mappedReviewCategories: ["rate_display"],
                qualityGateStatus: "passed",
                confidence: 0.93,
                createdAt: "2026-05-31T00:00:00.000Z"
              }
            ]
          })
        })
    );

    render(<RegulatoryWatchDashboard />);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(screen.getByText("예금 광고 내부 기준")).toBeInTheDocument();
    expect(screen.getByText("정상")).toBeInTheDocument();
    expect(screen.getByText("최고금리 표시 기준이 강화되었습니다.")).toBeInTheDocument();
    expect(screen.getByText("deposit")).toBeInTheDocument();
  });

  it("tracks registered knowledge document changes from the dashboard", async () => {
    const user = userEvent.setup();
    let resolveTrackRequest: (value: unknown) => void = () => {};
    const trackRequest = new Promise((resolve) => {
      resolveTrackRequest = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sources: [] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ changeSets: [] })
      })
      .mockReturnValueOnce(trackRequest)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sources: [
            {
              id: "reg-source-knowledge-deposit",
              tenantId: "tenant-demo",
              sourceType: "internal_policy_repo",
              name: "예금 광고 내부 기준",
              pollingSchedule: "manual",
              trustLevel: "internal",
              status: "active",
              lastCheckedAt: "2026-06-01T00:00:00.000Z",
              createdAt: "2026-06-01T00:00:00.000Z",
              updatedAt: "2026-06-01T00:00:00.000Z"
            }
          ]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          changeSets: [
            {
              id: "reg-change-001",
              tenantId: "tenant-demo",
              sourceId: "reg-source-knowledge-deposit",
              newSnapshotId: "reg-snapshot-001",
              changeType: "created",
              changeSummary: "최고금리 표시 기준이 신설되었습니다.",
              changedSections: [],
              riskImpactLevel: "high",
              interpretationSummary: "최고금리 조건 병기 기준 강화",
              mappedProductTypes: ["deposit"],
              mappedChannels: ["mobile_banner"],
              mappedReviewCategories: ["rate_display"],
              qualityGateStatus: "passed",
              confidence: 0.93,
              createdAt: "2026-06-01T00:00:00.000Z"
            }
          ]
        })
      });

    vi.stubGlobal("fetch", fetchMock);

    render(<RegulatoryWatchDashboard />);

    const trackButton = await screen.findByRole("button", { name: "변경 추적" });

    const click = user.click(trackButton);

    await waitFor(() =>
      expect(trackButton.querySelector(".action-spinner")).toBeInTheDocument()
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/regulatory-sources/track-knowledge-documents",
      expect.objectContaining({ method: "POST" })
    );
    resolveTrackRequest({
      ok: true,
      json: async () => ({
        result: {
          checkedDocumentCount: 1,
          changeSetCount: 1,
          activatedDocumentIds: ["knowledge-auto-reg-change-001"]
        }
      })
    });
    await click;
    await screen.findByText("등록 지식문서 1건을 확인했고 변경 1건을 감지했습니다.");
    expect(await screen.findByText("예금 광고 내부 기준")).toBeInTheDocument();
    expect(screen.getByText("최고금리 표시 기준이 신설되었습니다.")).toBeInTheDocument();
  });
});
