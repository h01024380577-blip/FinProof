import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import { within } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { RegulatoryWatchDashboard } from "./RegulatoryWatchDashboard";

function cssBlock(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return css.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[\\s\\S]*?)\\n\\}`))?.groups
    ?.body ?? "";
}

describe("RegulatoryWatchDashboard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows a spinner while regulatory watch information is loading", () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));

    render(<RegulatoryWatchDashboard />);

    const loadingMessage = screen.getByText("규제 변경 정보를 불러오는 중입니다.");

    expect(
      loadingMessage.closest(".form-status")?.querySelector(".action-spinner")
    ).toBeInTheDocument();
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
                changedSections: [
                  {
                    sectionId: "section-001",
                    title: "금융소비자 보호에 관한 감독규정",
                    diffSummary:
                      '권유하는 행위 4. 금융소비자(이하 "신용카드 회원"이라 한다)의 사전 동의 없이 신용카드를 사용하도록 유도하는 행위 5. 법 제17조를 적용받지 않고 권유하는 행위 <개정 2025. 10. 1.> 제16조(광고의 주체) 금융상품판매업자는 광고가 법령에 위배되는지를 확인해야 한다.',
                    citation: {
                      snapshotId: "reg-snapshot-001",
                      sectionId: "section-001"
                    }
                  }
                ],
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
    expect(screen.getByText("상품 deposit")).toBeInTheDocument();

    const sectionSummary = document.querySelector(".regulatory-change-card__sections p");
    expect(sectionSummary?.textContent).toContain("\n4. 금융소비자");
    expect(sectionSummary?.textContent).toContain("\n<개정 2025. 10. 1.>");
    expect(sectionSummary?.textContent).toContain("\n제16조");
    expect(document.querySelector(".regulatory-table--sources")).toHaveClass(
      "regulatory-scroll-region--sources"
    );
    expect(document.querySelector(".regulatory-change-list")).toHaveClass(
      "regulatory-scroll-region--changes"
    );
  });

  it("shows only change sets with changed sections in the recent change list", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ sources: [] })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            changeSets: [
              {
                id: "reg-change-empty",
                tenantId: "tenant-demo",
                sourceId: "reg-source-001",
                newSnapshotId: "reg-snapshot-empty",
                changeType: "amended",
                changeSummary: "이미 추적 완료된 기준입니다.",
                changedSections: [],
                riskImpactLevel: "info",
                interpretationSummary: "새로 변경된 조항이 없습니다.",
                mappedProductTypes: [],
                mappedChannels: [],
                mappedReviewCategories: [],
                qualityGateStatus: "passed",
                confidence: 0.9,
                createdKnowledgeDocumentId: "knowledge-auto-existing",
                createdAt: "2026-06-01T00:00:00.000Z"
              },
              {
                id: "reg-change-with-content",
                tenantId: "tenant-demo",
                sourceId: "reg-source-001",
                newSnapshotId: "reg-snapshot-002",
                changeType: "created",
                changeSummary: "신용카드 권유 제한 조항이 신설되었습니다.",
                changedSections: [
                  {
                    sectionId: "section-002",
                    title: "금융소비자 보호에 관한 감독규정",
                    diffSummary: "신설 조항입니다.",
                    citation: {
                      snapshotId: "reg-snapshot-002",
                      sectionId: "section-002"
                    }
                  }
                ],
                riskImpactLevel: "high",
                interpretationSummary: "신용카드 권유 제한 기준 신설",
                mappedProductTypes: ["loan"],
                mappedChannels: ["branch"],
                mappedReviewCategories: ["law"],
                qualityGateStatus: "failed",
                confidence: 0.86,
                createdAt: "2026-06-01T00:10:00.000Z"
              }
            ]
          })
        })
    );

    render(<RegulatoryWatchDashboard />);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    const recentChangePanel = screen.getByLabelText("최근 규제 변경");
    expect(within(recentChangePanel).getByText("1건")).toBeInTheDocument();
    expect(screen.getByText("신용카드 권유 제한 조항이 신설되었습니다.")).toBeInTheDocument();
    expect(screen.queryByText("이미 추적 완료된 기준입니다.")).not.toBeInTheDocument();
  });

  it("lets regulatory section summaries preserve readable line breaks without clamping", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const sectionSummaryBlock = cssBlock(css, ".regulatory-change-card__sections p");

    expect(sectionSummaryBlock).toContain("white-space: pre-wrap");
    expect(sectionSummaryBlock).toContain("overflow-wrap: anywhere");
    expect(sectionSummaryBlock).not.toContain("-webkit-line-clamp");
  });

  it("summarizes dense legal provision text instead of rendering the raw source", async () => {
    const denseLegalText =
      "삭제 <2020. 3. 24.> 제18조의6(광고의 자율심의) ① 상호저축은행이 예금등, 대출, 후순위채권 등 자신이 취급하는 상품에 관하여 광고를 하려는 경우에는 광고계획신고서와 광고안을 제25조에 따른 상호저축은행중앙회에 제출하여 심의를 받아야 한다. <개정 2020. 3. 24.> ② 중앙회는 제1항에 따른 심의 결과 광고의 내용이 사실과 다르거나 금융소비자 보호에 관한 법률 제22조를 위반하여 광고하려는 경우에는 해당 상호저축은행에 대하여 광고의 시정이나 사용중단을 요구할 수 있다. 이 경우 해당 상호저축은행은 정당한 사유가 없으면 중앙회의 요구에 성실히 응하여야 한다. <개정 2020. 3. 24.> ③ 중앙회는 매분기별 광고 심의 결과를 해당 분기의 말일부터 1개월 이내에 금융위원회에 보고하여야 한다. [본조신설 2013. 8. 13.] 제18조의7(고객응대직원에 대한 보호 조치 의무) ① 상호저축은행은 고객을 직접 응대하는 직원을 보호하기 위하여 다음 각 호의 조치를 하여야 한다. 1. 직원이 요청하는 경우 해당 고객으로부터의 분리 및 업무담당자 교체 2. 직원에 대한 치료 및 상담 지원 3. 고객을 직접 응대하는 직원의 요구를 이유로 직원에게 불이익을 주어서는 아니 된다. [본조신설 2016. 3. 29.] 제19조(이익금의 처리) ① 상호저축은행은 자본금의 총액이 될 때까지 매 사업연도의 이익금의 100분의 10 이상을 적립금으로 적립하여야 한다. [전문개정 2010. 3. 22.] 제20조 삭제 <1999. 2. 1.> 제21조(해산) 상호저축은행은 다음 각 호의 어느 하나에 해당하는 사유가 있으면 해산한다. 1. 제24조 제2항에 따른 영업인가의 취소 2. 제10조 제1항 제1호에 따른 합병 또는 같은 항 제2호에 따른 영업전부의 폐업ㆍ양도 3. 제24조의9 제3항, 제24조의11 제1항 또는 제24조의15 제2항에 따른 계약의 전부이전 4. 금융산업의 구조개선에 관한 법률 제14조 제2항에 따른 계약이전 또는 같은 법 제26조에 따른 영업의 전부양도 [전문개정 2010. 3. 22.] 제3장 감독 <개정 2010. 3. 22.> 제22조(감독)";

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ sources: [] })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            changeSets: [
              {
                id: "reg-change-dense-law",
                tenantId: "tenant-demo",
                sourceId: "reg-source-law",
                newSnapshotId: "reg-snapshot-law",
                changeType: "created",
                changeSummary: "상호저축은행법 변경: 삭제 <2020. 3. 24.> 제18조의6",
                changedSections: [
                  {
                    sectionId: "section-dense-law",
                    title: "상호저축은행법",
                    diffSummary: denseLegalText,
                    citation: {
                      snapshotId: "reg-snapshot-law",
                      sectionId: "section-dense-law"
                    }
                  }
                ],
                riskImpactLevel: "high",
                interpretationSummary: "상호저축은행법 변경분은 광고 심의 지식베이스에 자동 반영됩니다.",
                mappedProductTypes: ["loan"],
                mappedChannels: ["mobile_banner"],
                mappedReviewCategories: ["law"],
                qualityGateStatus: "passed",
                confidence: 0.92,
                createdAt: "2026-06-01T09:24:00.000Z"
              }
            ]
          })
        })
    );

    render(<RegulatoryWatchDashboard />);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    const sectionSummary = document.querySelector(".regulatory-change-card__sections p");

    expect(sectionSummary?.textContent).toBe("상호저축은행법 변경사항이 감지되었습니다.");
    expect(sectionSummary?.textContent).not.toContain("제18조의6");
    expect(sectionSummary?.textContent).not.toContain("제19조(이익금의 처리)");
  });

  it("shows only the section change summary when full section text is available", async () => {
    const fullSectionText =
      "에 위반되는 매매, 그 밖의 거래를 하고자 한다는 사실을 알고 그 매매, 그 밖의 거래를 권유하는 행위 4. 금융소비자(이하 \"신용카드 회원\"이라 한다)의 사전 동의 없이 신용카드를 사용하도록 유도하거나 다른 대출성 상품을 권유하는 행위 5. 법 제17조를 적용받지 않고 권유하기 위해 일반금융소비자로부터 계약 체결의 권유를 원하지 않는다는 의사를 서면 등으로 받는 행위 <개정 2025. 10. 1.> 제16조(광고의 주체) ① 금융상품직접판매업자는 광고가 법령에 위배되는지를 확인해야 한다. 제17조(광고의 내용) ① 영 제18조제1항제1호라목에서 \"금융위원회가 정하여 고시하는 사항\"이란 다음 각 호의 구분에 따른 사항을 말한다. 1. 보장성 상품 가. 보험금 지급제한 사유 나. 이자율의 범위 및 산출기준 4. 대출성 상품: 다음 각 목의 구분에 따른 사항 가. 신용카드 1) 연회비 2) 연체율 나. 시설대여ㆍ연불판매ㆍ할부금융 1) 연체율 2) 수수료 3) 금융소비자가 계약기간 중 금전ㆍ재화를 상환하는 경우 적용받는 조건 다. 그 밖의 대출성 상품 1) 이자율의 범위 및 산출기준 2) 이자 부과시기";

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ sources: [] })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            changeSets: [
              {
                id: "reg-change-generic-diff",
                tenantId: "tenant-demo",
                sourceId: "reg-source-law",
                newSnapshotId: "reg-snapshot-law",
                changeType: "created",
                changeSummary: "금융소비자 보호에 관한 감독규정 변경",
                changedSections: [
                  {
                    sectionId: "section-generic-diff",
                    title: "금융소비자 보호에 관한 감독규정",
                    diffSummary: "신설 조항입니다.",
                    newText: fullSectionText,
                    citation: {
                      snapshotId: "reg-snapshot-law",
                      sectionId: "section-generic-diff"
                    }
                  }
                ],
                riskImpactLevel: "high",
                interpretationSummary:
                  "금융소비자 보호에 관한 감독규정 변경분은 광고 심의 지식베이스에 자동 반영됩니다.",
                mappedProductTypes: [],
                mappedChannels: ["mobile_banner"],
                mappedReviewCategories: ["law"],
                qualityGateStatus: "failed",
                confidence: 0.89,
                createdAt: "2026-06-01T09:29:00.000Z"
              }
            ]
          })
        })
    );

    render(<RegulatoryWatchDashboard />);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    const sectionSummary = document.querySelector(".regulatory-change-card__sections p");
    const sectionText = sectionSummary?.textContent ?? "";

    expect(sectionText).toBe("신설 조항입니다.");
    expect(sectionText).not.toContain("금융소비자");
    expect(sectionText).not.toContain("연회비");
  });

  it("keeps body-like section titles and full text out of the summary body", async () => {
    const bodyLikeTitle =
      "에 위반되는 매매, 그 밖의 거래를 하고자 한다는 사실을 알고 그 매매, 그 밖의 거래를 권유하는 행위 4. 금융소비자(이하 \"신용카드 회원\"이라 한다)의 사전 동의 없이 신용카드를 사용하도록 유도하거나 다른 대출성 상품을 권유하는 행위 5. 법 제17조를 적용받지 않고 권유하기 위해 일반금융소비자로부터 계약 체결의 권유를 원하지 않는다는 의사를 서면 등으로 받는 행위 6. 법 제17조제2항 및 제18조제1항 내지 제2항 에 따라 일반금융소비자로부터 정보를 파악하거나 확인을 받을 때에 일반금융소비자가 특정한 답변을 하도록 유도하는 행위 7. 일반금융소비자와 대면하여 투자성 상품의 계약 체결을 권유한 후 일반금융소비자로부터 요청받지 아니하였음에도, 유선ㆍ무선ㆍ화상통신ㆍ컴퓨터 등 정보통신기술을 활용한 비대면 방식으로 계약할 것을 권유하거나 금융상품판매업자등이 일반금융소비자를 대신하여 비대면 방식의 투자성상품 계약을 체결하는 행위 <개정 2025. 10. 1.> 제16조(광고의 주체) ① 금융상품직접판매업자는 광고가 법령에 위배되는지를 확인해야 한다.";
    const continuationText =
      "연체율 나. 시설대여ㆍ연불판매ㆍ할부금융 1) 연체율 2) 수수료 3) 금융소비자가 계약기간 중 금전ㆍ재화를 상환하는 경우 적용받는 조건 다. 그 밖의 대출성 상품 1) 이자율의 범위 및 산출기준 2) 이자 부과시기";

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ sources: [] })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            changeSets: [
              {
                id: "reg-change-body-title",
                tenantId: "tenant-demo",
                sourceId: "reg-source-law",
                newSnapshotId: "reg-snapshot-law",
                changeType: "created",
                changeSummary: "금융소비자 보호에 관한 감독규정 변경",
                changedSections: [
                  {
                    sectionId: "section-body-title",
                    title: bodyLikeTitle,
                    diffSummary: "신설 조항입니다.",
                    newText: continuationText,
                    citation: {
                      snapshotId: "reg-snapshot-law",
                      sectionId: "section-body-title"
                    }
                  }
                ],
                riskImpactLevel: "high",
                interpretationSummary:
                  "금융소비자 보호에 관한 감독규정 변경분은 광고 심의 지식베이스에 자동 반영됩니다.",
                mappedProductTypes: [],
                mappedChannels: ["mobile_banner"],
                mappedReviewCategories: ["law"],
                qualityGateStatus: "failed",
                confidence: 0.89,
                createdAt: "2026-06-01T09:29:00.000Z"
              }
            ]
          })
        })
    );

    render(<RegulatoryWatchDashboard />);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    const section = document.querySelector(".regulatory-change-card__sections div");
    const sectionTitle = section?.querySelector("strong")?.textContent ?? "";
    const sectionText = section?.querySelector("p")?.textContent ?? "";

    expect(sectionTitle).toBe("변경 조항 본문");
    expect(sectionTitle).not.toContain("신용카드 회원");
    expect(sectionText).toBe("신설 조항입니다.");
    expect(sectionText).not.toContain("신용카드 회원");
    expect(sectionText).not.toContain("연체율");
  });

  it("does not render product document source text when a summary is available", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ sources: [] })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            changeSets: [
              {
                id: "reg-change-product-summary",
                tenantId: "tenant-demo",
                sourceId: "reg-source-product",
                newSnapshotId: "reg-snapshot-product",
                changeType: "created",
                changeSummary: "삼성화재 상품 및 약관 요약서 변경",
                changedSections: [
                  {
                    sectionId: "section-product-summary",
                    title: "삼성화재 상품 및 약관 요약서",
                    diffSummary: "신설 조항입니다.",
                    newText:
                      "version: 보험요약시설물 / 2023-04 제목: 삼성화재 상품 및 약관 요약서 발행기관: 삼성화재 원본URL: https://www.samsungfire.co.kr/download/product/P02_07_02_163_2304.pdf 참고분류: 보험요약시설물 쉽게 이해하는 상품 및 약관 요약서 소비자가 반드시 알아두어야 할 유의사항",
                    citation: {
                      snapshotId: "reg-snapshot-product",
                      sectionId: "section-product-summary"
                    }
                  }
                ],
                riskImpactLevel: "info",
                interpretationSummary:
                  "삼성화재 상품 및 약관 요약서 변경분은 광고 심의 지식베이스에 자동 반영됩니다.",
                mappedProductTypes: ["insurance"],
                mappedChannels: ["mobile_banner"],
                mappedReviewCategories: ["law"],
                qualityGateStatus: "passed",
                confidence: 0.89,
                createdAt: "2026-06-01T09:30:00.000Z"
              }
            ]
          })
        })
    );

    render(<RegulatoryWatchDashboard />);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    const section = document.querySelector(".regulatory-change-card__sections div");
    const sectionTitle = section?.querySelector("strong")?.textContent ?? "";
    const sectionText = section?.querySelector("p")?.textContent ?? "";

    expect(sectionTitle).toBe("삼성화재 상품 및 약관 요약서");
    expect(sectionText).toBe("신설 조항입니다.");
    expect(sectionText).not.toContain("version:");
    expect(sectionText).not.toContain("원본URL");
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
              changedSections: [
                {
                  sectionId: "section-rate-display",
                  title: "최고금리 표시 기준",
                  diffSummary: "신설 조항입니다.",
                  citation: {
                    snapshotId: "reg-snapshot-001",
                    sectionId: "section-rate-display"
                  }
                }
              ],
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

    await waitFor(() => expect(trackButton.querySelector(".action-spinner")).toBeInTheDocument());

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
