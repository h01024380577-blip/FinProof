import { isSocialContextEvidence } from "@/domain/social-context";
import type { ReviewIssue } from "@/domain/types";

export type IssueAgentBadgeTone =
  | "main"
  | "creative"
  | "product"
  | "regulation"
  | "policy"
  | "social"
  | "evidence"
  | "case"
  | "multilingual"
  | "system"
  | "manual";

export type IssueAgentBadge = {
  key: string;
  listLabel: string;
  detailLabel: string;
  tone: IssueAgentBadgeTone;
  priority: number;
};

const AGENT_BADGES: Record<string, IssueAgentBadge> = {
  main: {
    key: "main",
    listLabel: "종합",
    detailLabel: "종합 판단",
    tone: "main",
    priority: 10
  },
  creative_review: {
    key: "creative_review",
    listLabel: "표현",
    detailLabel: "표현 심의",
    tone: "creative",
    priority: 20
  },
  creative: {
    key: "creative",
    listLabel: "표현",
    detailLabel: "표현 심의",
    tone: "creative",
    priority: 20
  },
  product_terms: {
    key: "product_terms",
    listLabel: "상품",
    detailLabel: "상품조건",
    tone: "product",
    priority: 30
  },
  product_terms_agent: {
    key: "product_terms_agent",
    listLabel: "상품",
    detailLabel: "상품조건",
    tone: "product",
    priority: 30
  },
  regulation: {
    key: "regulation",
    listLabel: "법령",
    detailLabel: "법령",
    tone: "regulation",
    priority: 40
  },
  internal_policy: {
    key: "internal_policy",
    listLabel: "내규",
    detailLabel: "내규",
    tone: "policy",
    priority: 50
  },
  social_context_risk: {
    key: "social_context_risk",
    listLabel: "사회맥락",
    detailLabel: "사회맥락 리스크",
    tone: "social",
    priority: 60
  },
  evidence_verification: {
    key: "evidence_verification",
    listLabel: "근거",
    detailLabel: "근거 검증",
    tone: "evidence",
    priority: 70
  },
  case_search: {
    key: "case_search",
    listLabel: "사례",
    detailLabel: "사례 검색",
    tone: "case",
    priority: 80
  },
  english_translator_risk: {
    key: "english_translator_risk",
    listLabel: "영문",
    detailLabel: "영문 리스크",
    tone: "multilingual",
    priority: 90
  },
  vietnamese_translator_risk: {
    key: "vietnamese_translator_risk",
    listLabel: "베트남",
    detailLabel: "베트남어 리스크",
    tone: "multilingual",
    priority: 91
  },
  myanmar_translator_risk: {
    key: "myanmar_translator_risk",
    listLabel: "미얀마",
    detailLabel: "미얀마어 리스크",
    tone: "multilingual",
    priority: 92
  },
  khmer_translator_risk: {
    key: "khmer_translator_risk",
    listLabel: "크메르",
    detailLabel: "크메르어 리스크",
    tone: "multilingual",
    priority: 93
  },
  korean_compliance_mapping: {
    key: "korean_compliance_mapping",
    listLabel: "국문",
    detailLabel: "국문 준법 매핑",
    tone: "multilingual",
    priority: 94
  },
  ocr: {
    key: "ocr",
    listLabel: "OCR",
    detailLabel: "OCR",
    tone: "system",
    priority: 100
  },
  rag: {
    key: "rag",
    listLabel: "RAG",
    detailLabel: "RAG",
    tone: "system",
    priority: 101
  },
  "rule-engine": {
    key: "rule-engine",
    listLabel: "규칙",
    detailLabel: "규칙 기반",
    tone: "system",
    priority: 102
  },
  manual: {
    key: "manual",
    listLabel: "수동",
    detailLabel: "수동 추가",
    tone: "manual",
    priority: 110
  }
};

export function issueAgentBadges(issue: ReviewIssue): IssueAgentBadge[] {
  // 사회맥락 리스크만 태깅한다. 그 외 에이전트 출처는 배지로 표시하지 않는다.
  const hasSocialContextEvidence = issue.evidence.some(isSocialContextEvidence);
  const isSocialContextIssue = issue.issueType.toUpperCase().startsWith("SOCIAL_CONTEXT_");
  const fromSocialContextAgent = issue.sourceAgents.includes("social_context_risk");

  if (hasSocialContextEvidence && (isSocialContextIssue || fromSocialContextAgent)) {
    return [AGENT_BADGES.social_context_risk];
  }

  return [];
}
