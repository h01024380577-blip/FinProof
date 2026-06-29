"use client";

import type { JSX } from "react";
import { riskLabels, statusLabels } from "@/domain/reviews";
import type { ReviewVersion } from "@/domain/types";
import styles from "./VersionHistoryPanel.module.css";

export type VersionHistoryPanelProps = {
  version: ReviewVersion;
};

export function VersionHistoryPanel({ version }: VersionHistoryPanelProps): JSX.Element {
  const decidedAt = formatDecidedAt(version.decidedAt);

  return (
    <section className={styles.panel} aria-label={`심의 ${version.versionNumber}회차 스냅샷`}>
      <div className={`panel ${styles.summary}`}>
        <div className={styles.summaryHead}>
          <div>
            <p className="eyebrow">Review Version</p>
            <h3>{version.versionNumber}회차 심의 결과</h3>
          </div>
          <span className={styles.statusTag} data-status={version.status}>
            {statusLabels[version.status]}
          </span>
        </div>
        <dl className={styles.meta}>
          {version.decidedByName ? (
            <div>
              <dt>결정자</dt>
              <dd>{version.decidedByName}</dd>
            </div>
          ) : null}
          {decidedAt ? (
            <div>
              <dt>결정 일시</dt>
              <dd>{decidedAt}</dd>
            </div>
          ) : null}
        </dl>
        {version.reviewerComment ? (
          <div className={styles.block}>
            <span className={styles.blockLabel}>심의자 코멘트</span>
            <p>{version.reviewerComment}</p>
          </div>
        ) : null}
        {version.opinionDraft ? (
          <div className={styles.block}>
            <span className={styles.blockLabel}>의견서</span>
            <p className={styles.opinionDraft}>{version.opinionDraft}</p>
          </div>
        ) : null}
      </div>

      <div className={`panel ${styles.issues}`}>
        <div className={styles.summaryHead}>
          <div>
            <p className="eyebrow">Snapshot Issues</p>
            <h3>이슈 스냅샷 ({version.issuesSnapshot.length})</h3>
          </div>
        </div>
        {version.issuesSnapshot.length > 0 ? (
          <ul className={styles.issueList}>
            {version.issuesSnapshot.map((issue, index) => (
              <li key={issue.id} className={styles.issueItem} data-risk={issue.riskLevel}>
                <div className={styles.issueTop}>
                  <small>#{index + 1}</small>
                  <span className={styles.riskTag} data-risk={issue.riskLevel}>
                    {riskLabels[issue.reviewerRiskLevel ?? issue.riskLevel]}
                  </span>
                </div>
                <strong>{issue.title}</strong>
                {issue.targetText ? <p className={styles.issueExcerpt}>{issue.targetText}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>이 회차에는 기록된 이슈가 없습니다.</p>
        )}
      </div>

      <div className={`panel ${styles.files}`}>
        <div className={styles.summaryHead}>
          <div>
            <p className="eyebrow">Submitted Files</p>
            <h3>제출 파일 ({version.filesSnapshot.length})</h3>
          </div>
        </div>
        {version.filesSnapshot.length > 0 ? (
          <ul className={styles.fileList}>
            {version.filesSnapshot.map((file) => (
              <li key={file.id}>{file.name}</li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>제출 파일 기록이 없습니다.</p>
        )}
      </div>
    </section>
  );
}

function formatDecidedAt(value: string): string {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
