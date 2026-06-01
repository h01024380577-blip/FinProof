"use client";

import type { JSX } from "react";
import type { ProductType } from "@/domain/types";

export type IntakeChannelsState = {
  mobile_app: boolean;
  website: boolean;
  offline: boolean;
};

export type IntakeMetaState = {
  title: string;
  affiliate: string;
  requestDepartment: string;
  productType: ProductType | "";
  plannedPublishDate: string;
  channels: IntakeChannelsState;
  requestMemo: string;
};

export type IntakeMetaFormProps = {
  state: IntakeMetaState;
  onChange: (next: IntakeMetaState) => void;
};

export function IntakeMetaForm({ state, onChange }: IntakeMetaFormProps): JSX.Element {
  function patch(partial: Partial<IntakeMetaState>): void {
    onChange({ ...state, ...partial });
  }

  return (
    <div className="panel panel--compact intake-metadata-panel">
      <label className="intake-field intake-field--wide">
        <span>심의 요청 제목 *</span>
        <input
          aria-label="심의 요청 제목"
          placeholder="예: 광주은행 모바일 앱 신규 예금 상품 홍보물 심의"
          value={state.title}
          onChange={(event) => patch({ title: event.target.value })}
        />
      </label>

      <label className="intake-field">
        <span>계열사 *</span>
        <input
          aria-label="계열사"
          placeholder="예: 하나은행"
          value={state.affiliate}
          onChange={(event) => patch({ affiliate: event.target.value })}
        />
      </label>

      <label className="intake-field">
        <span>요청 부서 *</span>
        <input
          aria-label="요청 부서"
          placeholder="예: 디지털마케팅팀"
          value={state.requestDepartment}
          onChange={(event) => patch({ requestDepartment: event.target.value })}
        />
      </label>

      <label className="intake-field">
        <span>상품군 *</span>
        <select
          aria-label="상품군"
          value={state.productType}
          onChange={(event) => patch({ productType: event.target.value as ProductType | "" })}
        >
          <option value="" disabled>
            상품군을 선택하세요
          </option>
          <option value="deposit">예금/적금</option>
          <option value="loan">대출</option>
          <option value="card">카드</option>
          <option value="investment">투자상품</option>
        </select>
      </label>

      <label className="intake-field">
        <span>게시 예정일 *</span>
        <input
          aria-label="게시 예정일"
          type="date"
          value={state.plannedPublishDate}
          onChange={(event) => patch({ plannedPublishDate: event.target.value })}
        />
      </label>

      <fieldset className="channel-fieldset">
        <legend>게시 채널</legend>
        {(
          [
            ["mobile_app", "모바일 앱"],
            ["website", "웹사이트"],
            ["offline", "오프라인"]
          ] as const
        ).map(([channel, label]) => (
          <label key={channel}>
            <input
              type="checkbox"
              checked={state.channels[channel]}
              onChange={(event) =>
                patch({
                  channels: { ...state.channels, [channel]: event.target.checked }
                })
              }
            />
            {label}
          </label>
        ))}
      </fieldset>

      <label className="intake-field intake-field--wide">
        <span>요청 메모</span>
        <textarea
          aria-label="요청 메모"
          placeholder="예: 금리 조건 표시와 유의사항 문구를 중점 검토해 주세요."
          value={state.requestMemo}
          onChange={(event) => patch({ requestMemo: event.target.value })}
        />
      </label>
    </div>
  );
}
