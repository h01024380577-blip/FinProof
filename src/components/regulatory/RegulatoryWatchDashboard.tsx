"use client";

import { useEffect, useMemo, useState, type JSX } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Database } from "lucide-react";
import { regulatorySourceStatusLabel } from "@/domain/regulatory";
import type { QualityGateStatus, RegulatoryChangeSet, RegulatorySource } from "@/domain/types";
import { useRoleContext } from "@/components/RoleContext";

type RegulatorySourcesResponse = {
  sources?: RegulatorySource[];
};

type RegulatoryChangeSetsResponse = {
  changeSets?: RegulatoryChangeSet[];
};

function fetchInit(headers: HeadersInit | undefined): RequestInit | undefined {
  return headers ? { headers } : undefined;
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

export function RegulatoryWatchDashboard(): JSX.Element {
  const roleContext = useRoleContext();
  const [sources, setSources] = useState<RegulatorySource[]>([]);
  const [changeSets, setChangeSets] = useState<RegulatoryChangeSet[]>([]);
  const [status, setStatus] = useState<string | null>("규제 변경 정보를 불러오는 중입니다.");

  useEffect(() => {
    let mounted = true;
    const headers = roleContext?.apiHeaders();

    async function loadRegulatoryWatch() {
      const [sourceResponse, changeSetResponse] = await Promise.all([
        fetch("/api/v1/regulatory-sources", fetchInit(headers)),
        fetch("/api/v1/regulatory-change-sets", fetchInit(headers))
      ]);

      if (!sourceResponse.ok || !changeSetResponse.ok) {
        throw new Error("규제 변경 정보를 불러오지 못했습니다.");
      }

      const sourceBody = (await sourceResponse.json()) as RegulatorySourcesResponse;
      const changeSetBody = (await changeSetResponse.json()) as RegulatoryChangeSetsResponse;

      if (mounted) {
        setSources(sourceBody.sources ?? []);
        setChangeSets(changeSetBody.changeSets ?? []);
        setStatus(null);
      }
    }

    void loadRegulatoryWatch().catch((error) => {
      if (mounted) {
        setStatus(error instanceof Error ? error.message : "규제 변경 정보를 불러오지 못했습니다.");
      }
    });

    return () => {
      mounted = false;
    };
  }, [roleContext]);

  const metrics = useMemo(() => {
    const failedSources = sources.filter((source) => source.status === "failing").length;
    const passedChanges = changeSets.filter(
      (changeSet) => changeSet.qualityGateStatus === "passed"
    ).length;
    const attentionChanges = changeSets.filter(
      (changeSet) => changeSet.qualityGateStatus !== "passed"
    ).length;

    return [
      { label: "추적 소스", value: sources.length, icon: Database },
      { label: "수집 실패", value: failedSources, icon: AlertTriangle },
      { label: "자동 반영", value: passedChanges, icon: CheckCircle2 },
      { label: "검토 필요", value: attentionChanges, icon: Clock3 }
    ];
  }, [changeSets, sources]);

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
        <div className="knowledge-page__metrics regulatory-page__metrics" aria-label="규제 추적 현황">
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
      </section>

      {status ? <p className="form-status">{status}</p> : null}

      <section className="regulatory-layout">
        <section className="regulatory-panel" aria-label="추적 중인 규제 소스">
          <div className="knowledge-panel__header knowledge-panel__header--list">
            <div>
              <h2>추적 소스</h2>
              <p>수집 상태와 마지막 확인 시점을 기준으로 이상 징후를 확인합니다.</p>
            </div>
            <strong>{sources.length}건</strong>
          </div>

          <div className="regulatory-table regulatory-table--sources" role="table">
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
            <strong>{changeSets.length}건</strong>
          </div>

          <div className="regulatory-table regulatory-table--changes" role="table">
            <div className="regulatory-table__row regulatory-table__row--head" role="row">
              <span role="columnheader">변경 요약</span>
              <span role="columnheader">상품</span>
              <span role="columnheader">카테고리</span>
              <span role="columnheader">게이트</span>
            </div>
            {changeSets.length === 0 ? (
              <div className="regulatory-empty">최근 감지된 변경이 없습니다.</div>
            ) : (
              changeSets.map((changeSet) => (
                <div className="regulatory-table__row" role="row" key={changeSet.id}>
                  <strong role="cell">{changeSet.changeSummary}</strong>
                  <span role="cell">{changeSet.mappedProductTypes.join(", ") || "전체"}</span>
                  <span role="cell">
                    {changeSet.mappedReviewCategories.join(", ") || "미분류"}
                  </span>
                  <span role="cell">
                    <span className="status-pill" data-status={changeSet.qualityGateStatus}>
                      {gateStatusLabel(changeSet.qualityGateStatus)}
                    </span>
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
