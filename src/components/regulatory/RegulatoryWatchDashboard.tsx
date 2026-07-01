"use client";

import { useEffect, useMemo, useState, type JSX } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Database, LoaderCircle } from "lucide-react";
import { regulatorySourceStatusLabel } from "@/domain/regulatory";
import type { QualityGateStatus, RegulatoryChangeSet, RegulatorySource } from "@/domain/types";
import { useRoleContext } from "@/components/RoleContext";

type RegulatorySourcesResponse = {
  sources?: RegulatorySource[];
};

type RegulatoryChangeSetsResponse = {
  changeSets?: RegulatoryChangeSet[];
};

type PollRegulatorySourcesResponse = {
  started?: boolean;
  alreadyRunning?: boolean;
};

type PollSummary = { checked: number; changed: number; skipped: number; failed: number };

type PollStatusResponse = {
  running?: boolean;
  state?: {
    status?: "idle" | "running" | "done" | "error";
    summary?: PollSummary;
    error?: string;
  };
};

const POLL_STATUS_INTERVAL_MS = 3000;
const POLL_STATUS_MAX_ATTEMPTS = 60; // ~3분까지 대기 후 포기

function fetchInit(headers: HeadersInit | undefined): RequestInit | undefined {
  return headers ? { headers } : undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 온디맨드 폴은 백그라운드로 돌기 때문에, GET으로 상태를 폴링해 완료 요약을 받아온다.
async function waitForPollResult(
  headers: HeadersInit | undefined
): Promise<{ summary?: PollSummary; error?: string } | null> {
  for (let attempt = 0; attempt < POLL_STATUS_MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch("/api/v1/regulatory-sources/poll", fetchInit(headers));
    if (response.ok) {
      const body = (await response.json()) as PollStatusResponse;
      const status = body.state?.status;

      if (status === "done") {
        return { summary: body.state?.summary };
      }
      if (status === "error") {
        return { error: body.state?.error };
      }
    }
    // running / idle → 잠시 뒤 재조회
    await delay(POLL_STATUS_INTERVAL_MS);
  }

  return null; // 타임아웃
}

async function fetchRegulatoryWatch(headers: HeadersInit | undefined) {
  const [sourceResponse, changeSetResponse] = await Promise.all([
    fetch("/api/v1/regulatory-sources", fetchInit(headers)),
    fetch("/api/v1/regulatory-change-sets", fetchInit(headers))
  ]);

  if (!sourceResponse.ok || !changeSetResponse.ok) {
    throw new Error("규제 변경 정보를 불러오지 못했습니다.");
  }

  const sourceBody = (await sourceResponse.json()) as RegulatorySourcesResponse;
  const changeSetBody = (await changeSetResponse.json()) as RegulatoryChangeSetsResponse;

  return {
    sources: sourceBody.sources ?? [],
    changeSets: changeSetBody.changeSets ?? []
  };
}

function formatDateTime(value?: string): string {
  if (!value) {
    return "미확인";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function gateStatusLabel(status: QualityGateStatus): string {
  if (status === "passed") {
    return "통과";
  }

  if (status === "flagged") {
    return "확인 필요";
  }

  return "실패";
}

function sourceTypeLabel(sourceType: RegulatorySource["sourceType"]): string {
  const labels: Record<RegulatorySource["sourceType"], string> = {
    regulator: "감독기관",
    law_portal: "법령 포털",
    association: "협회",
    internal_policy_repo: "내부 기준",
    case_knowledge: "사례 지식"
  };

  return labels[sourceType];
}

type RegulatoryChangedSectionView = RegulatoryChangeSet["changedSections"][number];

function compactForComparison(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isBodyLikeSectionTitle(value: string): boolean {
  const compacted = compactForComparison(value);

  if (compacted.length < 80) {
    return false;
  }

  return /(?:\s(?:[1-9]|1[0-9]|20)\.\s|[①②③④⑤⑥⑦⑧⑨⑩]|<[^>]+\d{4}\.|\[[^\]]+\d{4}\.|제\d+조(?:의\d+)?(?:\(|\s)|\d+\)\s|[가-하]\.\s)/.test(
    compacted
  );
}

function readableRegulatoryText(value: string, maxLength = 220): string {
  const compacted = value
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n[^\S\n]+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
  const trimmed =
    compacted.length > maxLength ? `${compacted.slice(0, maxLength).trim()}...` : compacted;

  return trimmed
    .replace(/\s+(?=<\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.>)/g, "\n")
    .replace(/\s+(?=<(?:개정|전문개정)\s+\d{4}\.)/g, "\n")
    .replace(/\s+(?=\[(?:본조신설|전문개정|제목개정)\s+\d{4}\.)/g, "\n")
    .replace(/(?<=다\.)\s+(?=이 경우|다음 각 [가-힣])/g, "\n")
    .replace(/\s+(?=[①②③④⑤⑥⑦⑧⑨⑩])/g, "\n")
    .replace(/(?<!\d\.)\s+(?=제\d+조(?:의\d+)?(?:\(|\s|$))/g, "\n")
    .replace(/\s+(?=제\d+장(?:\s|$))/g, "\n")
    .replace(/(^|[^\d])\s+((?:[1-9]|1[0-9]|20)\.)\s+(?=[가-힣A-Za-z"“「제])/g, "$1\n$2 ")
    .replace(/\s+(?=[가-하]\.\s+)/g, "\n")
    .replace(/\s+(?=\d+\)\s+)/g, "\n")
    .replace(/\s+(?=다\.\s+그 밖)/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

function isRawSourceText(value: string): boolean {
  const compacted = compactForComparison(value);

  if (compacted.length < 360) {
    return false;
  }

  return /(?:version:|원본URL|발행기관|참고분류|제\d+조(?:의\d+)?(?:\(|\s)|[①②③④⑤⑥⑦⑧⑨⑩]|\d+\)\s|[가-하]\.\s|<[^>]+\d{4}\.|\[[^\]]+\d{4}\.)/.test(
    compacted
  );
}

function changedSectionDisplayTitle(section: RegulatoryChangedSectionView): string {
  const title = section.title?.trim();
  const sectionNumber = section.sectionNumber?.trim();

  if (title && !isBodyLikeSectionTitle(title)) {
    return title;
  }

  return sectionNumber || (title ? "변경 조항 본문" : "변경 섹션");
}

function changedSectionFallbackSummary(section: RegulatoryChangedSectionView): string {
  return `${changedSectionDisplayTitle(section)} 변경사항이 감지되었습니다.`;
}

function changedSectionDisplayText(section: RegulatoryChangedSectionView): string {
  const summary = section.diffSummary.trim();

  if (!summary || isRawSourceText(summary)) {
    return changedSectionFallbackSummary(section);
  }

  return summary;
}

function hasChangedContent(changeSet: RegulatoryChangeSet): boolean {
  return changeSet.changedSections.length > 0;
}

function changeTypeLabel(changeType: RegulatoryChangeSet["changeType"]): string {
  const labels: Record<RegulatoryChangeSet["changeType"], string> = {
    created: "신설",
    amended: "개정",
    deleted: "삭제",
    wording_changed: "문구 변경",
    effective_date_changed: "시행일 변경",
    scope_changed: "적용 범위 변경",
    interpretation_changed: "해석 변경"
  };

  return labels[changeType];
}

function riskImpactLabel(riskImpactLevel: RegulatoryChangeSet["riskImpactLevel"]): string {
  const labels: Record<RegulatoryChangeSet["riskImpactLevel"], string> = {
    info: "낮음",
    caution: "주의",
    high: "높음",
    critical: "중대"
  };

  return labels[riskImpactLevel];
}

function valueList(values: string[], fallback: string): string {
  return values.length > 0 ? values.join(", ") : fallback;
}

export function RegulatoryWatchDashboard(): JSX.Element {
  const roleContext = useRoleContext();
  const [sources, setSources] = useState<RegulatorySource[]>([]);
  const [changeSets, setChangeSets] = useState<RegulatoryChangeSet[]>([]);
  const [status, setStatus] = useState<string | null>("규제 변경 정보를 불러오는 중입니다.");
  const [isLoadingWatch, setIsLoadingWatch] = useState(true);
  const [trackStatus, setTrackStatus] = useState<string | null>(null);
  const [isTracking, setIsTracking] = useState(false);

  useEffect(() => {
    let mounted = true;
    const headers = roleContext?.apiHeaders();

    void (async () => {
      try {
        const result = await fetchRegulatoryWatch(headers);

        if (mounted) {
          setSources(result.sources);
          setChangeSets(result.changeSets);
          setStatus(null);
          setIsLoadingWatch(false);
        }
      } catch (error) {
        if (mounted) {
          setStatus(
            error instanceof Error ? error.message : "규제 변경 정보를 불러오지 못했습니다."
          );
          setIsLoadingWatch(false);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [roleContext]);

  async function handleTrackKnowledgeDocuments() {
    setIsTracking(true);
    setTrackStatus(null);

    try {
      const headers = roleContext?.apiHeaders();
      const response = await fetch("/api/v1/regulatory-sources/poll", {
        method: "POST",
        body: "{}",
        ...fetchInit(headers)
      });

      if (!response.ok) {
        throw new Error("법령 변경 추적 실행에 실패했습니다.");
      }

      const body = (await response.json()) as PollRegulatorySourcesResponse;

      setTrackStatus(
        body.alreadyRunning
          ? "이미 진행 중인 추적의 결과를 기다리는 중입니다…"
          : "법령 변경을 추적하는 중입니다… (최대 1~2분 소요)"
      );

      const outcome = await waitForPollResult(headers);

      if (outcome?.summary) {
        const s = outcome.summary;
        setTrackStatus(
          `추적 완료 — 검토 ${s.checked}건 · 변경 ${s.changed}건 · 제외 ${s.skipped}건` +
            (s.failed ? ` · 실패 ${s.failed}건` : "") +
            (s.changed > 0
              ? " · 변경이 감지되어 알림으로 표시됩니다."
              : " · 변경 없음.")
        );
      } else if (outcome?.error) {
        setTrackStatus(`추적 중 오류가 발생했습니다: ${outcome.error}`);
      } else {
        setTrackStatus(
          "추적을 시작했습니다. 완료까지 시간이 걸려, 변경이 감지되면 알림으로 표시됩니다."
        );
      }

      const result = await fetchRegulatoryWatch(headers);
      setSources(result.sources);
      setChangeSets(result.changeSets);
      setStatus(null);
    } catch (error) {
      setTrackStatus(
        error instanceof Error ? error.message : "법령 변경 추적 실행에 실패했습니다."
      );
    } finally {
      setIsTracking(false);
    }
  }

  const recentChangeSets = useMemo(() => changeSets.filter(hasChangedContent), [changeSets]);

  const metrics = useMemo(() => {
    const failedSources = sources.filter((source) => source.status === "failing").length;
    const passedChanges = recentChangeSets.filter(
      (changeSet) => changeSet.qualityGateStatus === "passed"
    ).length;
    const attentionChanges = recentChangeSets.filter(
      (changeSet) => changeSet.qualityGateStatus !== "passed"
    ).length;

    return [
      { label: "추적 소스", value: sources.length, icon: Database },
      { label: "수집 실패", value: failedSources, icon: AlertTriangle },
      { label: "자동 반영", value: passedChanges, icon: CheckCircle2 },
      { label: "검토 필요", value: attentionChanges, icon: Clock3 }
    ];
  }, [recentChangeSets, sources]);

  return (
    <main className="knowledge-page regulatory-page">
      <section className="knowledge-page__header">
        <div className="knowledge-page__heading">
          <h1>규제 변경 자동 추적</h1>
          <p>
            금융 규제와 내부 기준 변경을 수집하고 품질 게이트를 통과한 기준만 심의 근거에
            반영합니다.
          </p>
        </div>
        <div className="regulatory-page__header-side">
          <div
            className="knowledge-page__metrics regulatory-page__metrics"
            aria-label="규제 추적 현황"
          >
            {metrics.map((metric) => {
              const Icon = metric.icon;

              return (
                <div key={metric.label}>
                  <Icon size={18} aria-hidden="true" />
                  <strong>{metric.value}</strong>
                  <span>{metric.label}</span>
                </div>
              );
            })}
          </div>
          <section className="regulatory-actions" aria-label="규제 변경 작업">
            <button
              className="button button--primary"
              type="button"
              onClick={handleTrackKnowledgeDocuments}
              disabled={isTracking}
            >
              {isTracking ? (
                <LoaderCircle className="action-spinner" size={17} aria-hidden="true" />
              ) : null}
              변경 추적
            </button>
            {trackStatus ? <p className="form-status">{trackStatus}</p> : null}
          </section>
        </div>
      </section>

      {status ? (
        <p className="form-status">
          {isLoadingWatch ? (
            <LoaderCircle className="action-spinner" size={17} aria-hidden="true" />
          ) : null}
          {status}
        </p>
      ) : null}

      <section className="regulatory-layout">
        <section className="regulatory-panel" aria-label="추적 중인 규제 소스">
          <div className="knowledge-panel__header knowledge-panel__header--list">
            <div>
              <h2>추적 소스</h2>
              <p>수집 상태와 마지막 확인 시점을 기준으로 이상 징후를 확인합니다.</p>
            </div>
            <strong>{sources.length}건</strong>
          </div>

          <div
            className="regulatory-table regulatory-table--sources regulatory-scroll-region--sources"
            role="table"
          >
            <div className="regulatory-table__row regulatory-table__row--head" role="row">
              <span role="columnheader">소스</span>
              <span role="columnheader">유형</span>
              <span role="columnheader">상태</span>
              <span role="columnheader">최근 확인</span>
            </div>
            {sources.length === 0 ? (
              <div className="regulatory-empty">추적 중인 규제 소스가 없습니다.</div>
            ) : (
              sources.map((source) => (
                <div className="regulatory-table__row" role="row" key={source.id}>
                  <strong role="cell">{source.name}</strong>
                  <span role="cell">{sourceTypeLabel(source.sourceType)}</span>
                  <span role="cell">
                    <span className="status-pill" data-status={source.status}>
                      {regulatorySourceStatusLabel(source.status)}
                    </span>
                  </span>
                  <span role="cell">{formatDateTime(source.lastCheckedAt)}</span>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="regulatory-panel" aria-label="최근 규제 변경">
          <div className="knowledge-panel__header knowledge-panel__header--list">
            <div>
              <h2>최근 변경</h2>
              <p>품질 게이트 결과와 매핑 범위를 기준으로 반영 상태를 추적합니다.</p>
            </div>
            <strong>{recentChangeSets.length}건</strong>
          </div>

          <div className="regulatory-change-list regulatory-scroll-region--changes">
            {recentChangeSets.length === 0 ? (
              <div className="regulatory-empty">최근 감지된 변경이 없습니다.</div>
            ) : (
              recentChangeSets.map((changeSet) => {
                const highlightedSections = changeSet.changedSections.slice(0, 2);

                return (
                  <article className="regulatory-change-card" key={changeSet.id}>
                    <header className="regulatory-change-card__header">
                      <div className="regulatory-change-card__headline">
                        <span>{changeTypeLabel(changeSet.changeType)}</span>
                        <h3 title={changeSet.changeSummary}>
                          {readableRegulatoryText(changeSet.changeSummary, 140)}
                        </h3>
                      </div>
                      <span className="status-pill" data-status={changeSet.qualityGateStatus}>
                        {gateStatusLabel(changeSet.qualityGateStatus)}
                      </span>
                    </header>

                    <p className="regulatory-change-card__summary">
                      {readableRegulatoryText(changeSet.interpretationSummary, 180)}
                    </p>

                    {highlightedSections.length > 0 ? (
                      <div className="regulatory-change-card__sections">
                        {highlightedSections.map((section) => {
                          const sectionText = changedSectionDisplayText(section);

                          return (
                            <div key={section.sectionId}>
                              <strong>{changedSectionDisplayTitle(section)}</strong>
                              <p title={sectionText}>{readableRegulatoryText(sectionText, 3000)}</p>
                            </div>
                          );
                        })}
                        {changeSet.changedSections.length > highlightedSections.length ? (
                          <span>
                            외 {changeSet.changedSections.length - highlightedSections.length}개
                            섹션
                          </span>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="regulatory-change-card__meta" aria-label="변경 메타데이터">
                      <span>상품 {valueList(changeSet.mappedProductTypes, "전체")}</span>
                      <span>카테고리 {valueList(changeSet.mappedReviewCategories, "미분류")}</span>
                      <span>위험도 {riskImpactLabel(changeSet.riskImpactLevel)}</span>
                      <span>{formatDateTime(changeSet.createdAt)}</span>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
