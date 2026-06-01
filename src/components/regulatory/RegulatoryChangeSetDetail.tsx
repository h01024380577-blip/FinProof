import type { JSX } from "react";
import type { QualityGateResult, QualityGateType, RegulatoryChangeSet } from "@/domain/types";

type RegulatoryChangeSetDetailProps = {
  changeSet: RegulatoryChangeSet;
  qualityGateResults: QualityGateResult[];
};

function titleCase(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function gateLabel(gateType: QualityGateType): string {
  return titleCase(gateType);
}

export function RegulatoryChangeSetDetail({
  changeSet,
  qualityGateResults
}: RegulatoryChangeSetDetailProps): JSX.Element {
  return (
    <section className="regulatory-detail" aria-label="규제 변경 상세">
      <div className="knowledge-panel__header">
        <div>
          <h2>{changeSet.changeSummary}</h2>
          <p>{changeSet.interpretationSummary}</p>
        </div>
        <span className="status-pill" data-status={changeSet.qualityGateStatus}>
          {changeSet.qualityGateStatus}
        </span>
      </div>

      <div className="regulatory-detail__meta" aria-label="변경 매핑">
        <span>{changeSet.changeType}</span>
        <span>{changeSet.riskImpactLevel}</span>
        <span>{changeSet.mappedProductTypes.join(", ") || "전체 상품"}</span>
        <span>{changeSet.mappedReviewCategories.join(", ") || "미분류"}</span>
      </div>

      <div className="regulatory-detail__sections">
        {changeSet.changedSections.map((section) => (
          <article className="regulatory-diff" key={section.sectionId}>
            <header>
              <span>{section.sectionNumber ?? section.sectionId}</span>
              <h3>{section.title}</h3>
            </header>
            <p>{section.diffSummary}</p>
            <div className="regulatory-diff__columns">
              <div>
                <strong>이전</strong>
                <p>{section.previousText ?? "이전 문구 없음"}</p>
              </div>
              <div>
                <strong>변경</strong>
                <p>{section.newText ?? "변경 문구 없음"}</p>
              </div>
            </div>
          </article>
        ))}
      </div>

      <section className="regulatory-gates" aria-label="품질 게이트 결과">
        <h3>품질 게이트</h3>
        <div className="regulatory-table regulatory-table--gates" role="table">
          <div className="regulatory-table__row regulatory-table__row--head" role="row">
            <span role="columnheader">게이트</span>
            <span role="columnheader">상태</span>
            <span role="columnheader">요약</span>
          </div>
          {qualityGateResults.map((result) => (
            <div className="regulatory-table__row" role="row" key={result.id}>
              <strong role="cell">{gateLabel(result.gateType)}</strong>
              <span role="cell">{result.status}</span>
              <span role="cell">{result.summary}</span>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
