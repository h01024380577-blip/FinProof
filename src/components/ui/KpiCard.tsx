"use client";

import type { JSX, ReactNode } from "react";

export type KpiTone = "primary" | "neutral" | "warning" | "danger" | "success";

export type KpiCardProps = {
  label: string;
  value: number | string;
  tone?: KpiTone;
  hint?: ReactNode;
  onClick?: () => void;
  ariaLabel?: string;
};

export function KpiCard({
  label,
  value,
  tone = "neutral",
  hint,
  onClick,
  ariaLabel
}: KpiCardProps): JSX.Element {
  const content = (
    <>
      <span className="kpi-card__label">{label}</span>
      <strong className="kpi-card__value">{value}</strong>
      {hint ? <span className="kpi-card__hint">{hint}</span> : null}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className="kpi-card kpi-card--button"
        role="button"
        aria-label={ariaLabel ?? `${label} 필터 적용`}
        data-tone={tone}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return (
    <div className="kpi-card" role="group" aria-label={ariaLabel ?? label} data-tone={tone}>
      {content}
    </div>
  );
}
