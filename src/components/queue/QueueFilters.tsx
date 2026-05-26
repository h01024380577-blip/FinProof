"use client";

import type { JSX } from "react";
import { FilterBar, type FilterGroup } from "@/components/ui";
import type { ProductType, ReviewCase, RiskLevel } from "@/domain/types";

export type QueueFilterState = {
  search: string;
  status: ReviewCase["status"] | "all";
  risk: RiskLevel | "all" | "analysis_pending";
  product: ProductType | "all";
};

export type QueueFiltersProps = {
  state: QueueFilterState;
  onChange: (next: QueueFilterState) => void;
  onReset: () => void;
};

const statusOptions = [
  { value: "all", label: "상태: 전체" },
  { value: "analysis_waiting", label: "분석 대기" },
  { value: "analysis_complete", label: "분석 완료" },
  { value: "under_review", label: "검토 중" },
  { value: "change_requested", label: "수정 요청" },
  { value: "approved", label: "승인" },
  { value: "rejected", label: "반려" }
];

const riskOptions = [
  { value: "all", label: "위험도: 전체" },
  { value: "reject_recommended", label: "반려 권고" },
  { value: "high", label: "위험" },
  { value: "caution", label: "주의" },
  { value: "info", label: "참고" },
  { value: "analysis_pending", label: "분석 전" }
];

const productOptions = [
  { value: "all", label: "상품군: 전체" },
  { value: "deposit", label: "예금/적금" },
  { value: "loan", label: "대출" },
  { value: "card", label: "카드" },
  { value: "capital", label: "캐피탈" },
  { value: "insurance", label: "보험" },
  { value: "investment", label: "투자상품" }
];

export function QueueFilters({ state, onChange, onReset }: QueueFiltersProps): JSX.Element {
  const groups: FilterGroup[] = [
    { key: "status", label: "상태", value: state.status, defaultValue: "all", options: statusOptions },
    { key: "risk", label: "위험도", value: state.risk, defaultValue: "all", options: riskOptions },
    { key: "product", label: "상품군", value: state.product, defaultValue: "all", options: productOptions }
  ];

  return (
    <FilterBar
      searchValue={state.search}
      searchPlaceholder="심의 ID, 제목, 담당자 검색"
      onSearchChange={(value) => onChange({ ...state, search: value })}
      groups={groups}
      onGroupChange={(key, value) => onChange({ ...state, [key]: value } as QueueFilterState)}
      onReset={onReset}
    />
  );
}
