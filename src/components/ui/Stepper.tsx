"use client";

import type { JSX, ReactNode } from "react";

export type StepStatus = "pending" | "active" | "done";

export type StepperItem = { key: string; label: ReactNode; status: StepStatus };

export type StepperProps = {
  steps: StepperItem[];
  ariaLabel?: string;
};

export function Stepper({ steps, ariaLabel = "진행 단계" }: StepperProps): JSX.Element {
  return (
    <ol className="stepper" aria-label={ariaLabel}>
      {steps.map((step, index) => (
        <li key={step.key} data-status={step.status}>
          <span className="stepper__index" aria-hidden="true">
            {index + 1}
          </span>
          <span className="stepper__label">{step.label}</span>
        </li>
      ))}
    </ol>
  );
}
