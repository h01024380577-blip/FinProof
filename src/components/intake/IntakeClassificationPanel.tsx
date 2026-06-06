"use client";

import type { JSX } from "react";
import { FileCheck2, Loader2, Paperclip } from "lucide-react";
import type { ReviewFile } from "@/domain/types";

const fileTypeLabels: Record<string, string> = {
  promotional_creative: "홍보물 시안",
  copy_draft: "원문 카피",
  product_description: "상품 설명서",
  terms: "약관",
  rate_table: "금리표",
  checklist: "내부 체크리스트",
  internal_checklist: "내부 체크리스트",
  url_list: "URL 목록",
  package_archive: "압축 패키지",
  misc: "기타"
};

export type IntakeClassificationPanelProps = {
  files: ReviewFile[];
  isLoading?: boolean;
};

export function IntakeClassificationPanel({
  files,
  isLoading = false
}: IntakeClassificationPanelProps): JSX.Element {
  return (
    <section className="panel panel--compact intake-check-panel">
      <div className="panel__header">
        <div>
          <h3>자동 분류 확인 (업로드 된 파일)</h3>
        </div>
        {isLoading ? (
          <Loader2 className="action-spinner" size={18} aria-hidden="true" />
        ) : (
          <FileCheck2 size={20} aria-hidden="true" />
        )}
      </div>

      <div
        className="classification-list classification-list--scrollable"
        role="list"
        aria-label="자동 분류 파일 목록"
      >
        {isLoading ? (
          <article className="classification-row classification-row--empty" role="listitem">
            <Loader2 className="action-spinner" size={16} aria-hidden="true" />
            <div className="classification-row__body">
              <span>파일 분류 중</span>
              <strong className="classification-row__filename">ZIP 내용 분석 중...</strong>
            </div>
            <em>-</em>
          </article>
        ) : files.length > 0 ? (
          files.map((file) => (
            <article key={file.id} className="classification-row" role="listitem">
              <Paperclip size={16} aria-hidden="true" />
              <div className="classification-row__body">
                <span>{fileTypeLabels[file.fileType] ?? file.fileType}</span>
                <strong className="classification-row__filename">{file.name}</strong>
              </div>
              <div className="classification-row__confidence">
                <span>분류 신뢰도</span>
                <em>{Math.round(file.classificationConfidence * 100)}%</em>
              </div>
            </article>
          ))
        ) : (
          <article className="classification-row classification-row--empty" role="listitem">
            <Paperclip size={16} aria-hidden="true" />
            <div className="classification-row__body">
              <span>기타 첨부</span>
              <strong className="classification-row__filename">-</strong>
            </div>
            <em>대기</em>
          </article>
        )}
      </div>
    </section>
  );
}
