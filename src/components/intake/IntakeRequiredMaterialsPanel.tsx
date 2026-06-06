"use client";

import type { JSX, ReactNode } from "react";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import type { RequiredMaterialRow } from "@/domain/intake";

const extraLabelMap: Record<string, string> = {
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

export type IntakeRequiredMaterialsPanelProps = {
  rows: RequiredMaterialRow[];
  extraMissingMaterials: string[];
  children?: ReactNode;
};

export function IntakeRequiredMaterialsPanel({
  rows,
  extraMissingMaterials,
  children
}: IntakeRequiredMaterialsPanelProps): JSX.Element {
  return (
    <section className="panel panel--compact intake-check-panel">
      <div className="panel__header">
        <div>
          <h3>누락된 필수 자료</h3>
        </div>
        <TriangleAlert size={20} aria-hidden="true" />
      </div>

      <div className="materials-grid">
        {rows.length > 0 ? (
          rows.map((row) => (
            <div key={row.fileType} className="material-row" data-status="missing">
              <TriangleAlert size={16} aria-hidden="true" />
              <span>{row.label}</span>
              <div className="material-row__status">
                <strong>보완 필요</strong>
                <em>자료 유형 누락</em>
              </div>
            </div>
          ))
        ) : (
          <div className="material-row" data-status="present">
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>필수 자료</span>
            <strong>확인됨</strong>
          </div>
        )}
      </div>

      {extraMissingMaterials.length > 0 ? (
        <div className="missing-material-strip" aria-label="Additional missing materials">
          {extraMissingMaterials.map((material) => (
            <span key={material}>{extraLabelMap[material] ?? material}</span>
          ))}
        </div>
      ) : null}

      {children}
    </section>
  );
}
