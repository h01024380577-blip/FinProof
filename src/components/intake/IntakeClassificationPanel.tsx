"use client";

import type { JSX } from "react";
import { FileCheck2, Paperclip } from "lucide-react";
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
};

export function IntakeClassificationPanel({ files }: IntakeClassificationPanelProps): JSX.Element {
  return (
    <section className="panel panel--compact intake-check-panel">
      <div className="panel__header">
        <div>
          <h3>자동 분류 확인 (업로드 된 파일)</h3>
        </div>
        <FileCheck2 size={20} aria-hidden="true" />
      </div>

      <div className="classification-list">
        {files.length > 0 ? (
          files.map((file) => (
            <article key={file.id} className="classification-row">
              <Paperclip size={16} aria-hidden="true" />
              <div className="classification-row__body">
                <span>{fileTypeLabels[file.fileType] ?? file.fileType}</span>
                <strong className="classification-row__filename">{file.name}</strong>
              </div>
              <em>{Math.round(file.classificationConfidence * 100)}%</em>
            </article>
          ))
        ) : (
          <article className="classification-row classification-row--empty">
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
