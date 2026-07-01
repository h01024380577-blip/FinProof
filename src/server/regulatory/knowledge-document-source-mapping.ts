import type { KnowledgeDocument } from "@/domain/types";
import type { CreateRegulatorySourceInput } from "@/server/reviews/review-store";

/**
 * 등록된 지식문서를 규제 소스(RegulatorySource)에 매핑하기 위한 순수 헬퍼.
 * review-service의 지식문서-기반 변경추적 경로와 MCP 폴러가 동일한 소스 ID/타입을
 * 쓰도록 공유한다(중복 소스 생성 방지). 무거운 런타임 의존성 없이 타입만 참조한다.
 */

export function regulatorySourceTypeForDocument(
  document: KnowledgeDocument
): CreateRegulatorySourceInput["sourceType"] {
  return document.documentType === "law" ? "law_portal" : "internal_policy_repo";
}

export function regulatoryTrustLevelForDocument(
  document: KnowledgeDocument
): CreateRegulatorySourceInput["trustLevel"] {
  return document.documentType === "law" ? "official" : "internal";
}

export function stableRegulatorySourceId(document: KnowledgeDocument) {
  const rawKey = [
    document.canonicalKey,
    document.documentType,
    document.productType ?? "all",
    document.title
  ]
    .filter(Boolean)
    .join("-");
  const normalized = rawKey
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);

  return `reg-source-knowledge-${normalized || document.id}`;
}
