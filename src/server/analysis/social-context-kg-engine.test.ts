import type { ReviewCase } from "@/domain/types";
import { analyzeSocialContextKg, socialContextKgArtifacts } from "./social-context-kg-engine";

const baseReview: ReviewCase = {
  id: "rc-social-kg-001",
  title: "사회맥락 KG 테스트",
  affiliate: "광주은행",
  productType: "deposit",
  channelType: ["poster"],
  plannedPublishDate: "2026-06-20",
  status: "analysis_waiting",
  highestRiskLevel: "info",
  requester: "업로드 요청자",
  reviewer: "준법심의자",
  promotionalCopy: "",
  disclosure: "",
  productDescription: "",
  missingMaterials: [],
  files: [],
  issues: [],
  expectedDraft: "검토 필요",
  currentVersion: 1
};

function review(overrides: Partial<ReviewCase>): ReviewCase {
  return { ...baseReview, ...overrides };
}

describe("social context KG engine", () => {
  it("classifies a Sewol anniversary date plus sinking financial metaphor as high risk", () => {
    const matches = analyzeSocialContextKg({
      review: review({
        title: "4.16 단 하루 금리 침몰급 혜택",
        plannedPublishDate: "2026-04-16",
        promotionalCopy: "4.16 단 하루, 금리 침몰급 혜택!",
        productDescription: "자유적금 우대금리 이벤트"
      }),
      extractedDocuments: []
    });

    expect(matches[0]).toMatchObject({
      riskLevel: "high",
      suggestedAction: "hold",
      rule: {
        id: "disaster_date_financial_metaphor"
      },
      matchedDate: {
        date: "04-16"
      }
    });
    expect(matches[0].matchedEvents.map((event) => event.id)).toContain("sewol-0416");
    expect(matches[0].matchedPath.join(" ")).toContain("세월호 참사");
    expect(matches[0].matchedPath.join(" ")).toContain("침몰");
  });

  it("keeps a sinking financial metaphor on a non-sensitive date as a caution-level review", () => {
    const matches = analyzeSocialContextKg({
      review: review({
        plannedPublishDate: "2026-04-25",
        promotionalCopy: "금리 침몰급 혜택으로 오늘만 적금 이벤트",
        productDescription: "자유적금 우대금리 이벤트"
      }),
      extractedDocuments: []
    });

    expect(matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          riskLevel: "caution",
          rule: expect.objectContaining({
            id: "disaster_metaphor_financial_general"
          })
        })
      ])
    );
    expect(
      matches.find((match) => match.rule.id === "disaster_date_financial_metaphor")
    ).toBeUndefined();
  });

  it("classifies a Gwangju memorial date plus tank card promotion as high risk", () => {
    const matches = analyzeSocialContextKg({
      review: review({
        productType: "card",
        title: "탱크데이 혜택 폭격 이벤트",
        plannedPublishDate: "2026-05-18",
        promotionalCopy: "탱크데이 단 하루, 카드 혜택 폭격!",
        productDescription: "20대 고객 대상 카드 이벤트"
      }),
      extractedDocuments: []
    });

    expect(matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          riskLevel: "high",
          rule: expect.objectContaining({
            id: "democracy_memorial_military_symbol_promo"
          }),
          matchedDate: expect.objectContaining({
            date: "05-18"
          })
        })
      ])
    );
    expect(matches.flatMap((match) => match.matchedEvents.map((event) => event.id))).toContain(
      "gwangju-518"
    );
  });

  it("allows noncommercial commemoration context as an informational social-context finding", () => {
    const matches = analyzeSocialContextKg({
      review: review({
        productType: "image_test",
        title: "세월호 추모 기부 안내",
        plannedPublishDate: "2026-04-16",
        promotionalCopy: "노란 리본 추모 기부 캠페인에 함께합니다",
        productDescription: "임직원 사회공헌 안내"
      }),
      extractedDocuments: []
    });

    expect(matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          riskLevel: "info",
          suggestedAction: "approve",
          rule: expect.objectContaining({
            id: "safe_commemoration_noncommercial"
          })
        })
      ])
    );
    expect(
      matches.find((match) => match.rule.id === "disaster_date_financial_metaphor")
    ).toBeUndefined();
  });

  it("ignores a tank term when it is matched to an explicit safe context", () => {
    const matches = analyzeSocialContextKg({
      review: review({
        title: "Fish Tank 관리비 자동납부 이벤트",
        plannedPublishDate: "2026-05-18",
        promotionalCopy: "Fish Tank 관리비 자동납부 이벤트",
        productDescription: "수조 관리비 자동납부 안내"
      }),
      extractedDocuments: []
    });

    expect(
      matches.find((match) => match.rule.id === "democracy_memorial_military_symbol_promo")
    ).toBeUndefined();
  });

  it("creates social-context evidence and a linked social_context_risk finding", () => {
    const artifacts = socialContextKgArtifacts({
      review: review({
        title: "4.16 단 하루 금리 침몰급 혜택",
        plannedPublishDate: "2026-04-16",
        promotionalCopy: "4.16 단 하루, 금리 침몰급 혜택!"
      }),
      extractedDocuments: []
    });

    expect(artifacts.evidenceCandidates[0]).toMatchObject({
      sourceType: "internal_policy",
      title: expect.stringContaining("사회맥락 KG"),
      quoteSummary: expect.stringContaining("탐지 경로")
    });
    expect(artifacts.agentFindings[0]).toMatchObject({
      agent: "social_context_risk",
      issueType: "SOCIAL_CONTEXT_KG_DISASTER_DATE_FINANCIAL_METAPHOR",
      evidenceCandidateIds: [artifacts.evidenceCandidates[0].id]
    });
  });

  it("emits an ordered activation trace whose node ids match the rule result", () => {
    const traces: import("@/domain/social-context-kg").SocialContextTrace[] = [];
    const matches = analyzeSocialContextKg({
      review: review({
        title: "4.16 단 하루 금리 침몰급 혜택",
        plannedPublishDate: "2026-04-16",
        promotionalCopy: "4.16 단 하루, 금리 침몰급 혜택!",
        productDescription: "자유적금 우대금리 이벤트"
      }),
      extractedDocuments: [],
      onTrace: (trace) => traces.push(trace)
    });

    const phaseOrder = traces.map((trace) => trace.phase);
    // country is always first; rule is emitted last after matching completes.
    expect(phaseOrder[0]).toBe("country");
    expect(phaseOrder.at(-1)).toBe("rule");
    expect(phaseOrder.indexOf("event")).toBeLessThan(phaseOrder.indexOf("rule"));

    const countryTrace = traces.find((trace) => trace.phase === "country");
    expect(countryTrace?.nodeIds).toContain("south_korea");

    const eventTrace = traces.find((trace) => trace.phase === "event");
    expect(eventTrace?.nodeIds).toContain("sewol-0416");
    // the trace's activated event ids are exactly what the rule result reports
    expect(matches[0].matchedEvents.map((event) => event.id)).toEqual(
      expect.arrayContaining(eventTrace?.nodeIds ?? [])
    );

    const ruleTrace = traces.find((trace) => trace.phase === "rule");
    expect(ruleTrace?.nodeIds).toContain("disaster_date_financial_metaphor");
    expect(ruleTrace?.riskLevel).toBe("high");
  });
});
