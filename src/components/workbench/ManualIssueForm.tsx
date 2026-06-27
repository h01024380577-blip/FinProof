"use client";

import { useState, type FormEvent, type JSX } from "react";
import { LoaderCircle, X } from "lucide-react";
import type { ReviewIssue, RiskLevel } from "@/domain/types";
import styles from "./ManualIssueForm.module.css";

export type ManualIssueInput = {
  title: string;
  riskLevel: RiskLevel;
  suggestedAction: ReviewIssue["suggestedAction"];
  targetText?: string;
  description?: string;
  suggestedCopy?: string;
};

export type ManualIssueFormProps = {
  onSubmit: (input: ManualIssueInput) => void | Promise<void>;
  onClose: () => void;
  isSubmitting: boolean;
  error?: string | null;
};

const riskOptions: Array<{ value: RiskLevel; label: string }> = [
  { value: "info", label: "참고" },
  { value: "caution", label: "주의" },
  { value: "high", label: "위험" }
];

const actionOptions: Array<{ value: ReviewIssue["suggestedAction"]; label: string }> = [
  { value: "approve", label: "승인" },
  { value: "change_request", label: "수정요청" },
  { value: "reject", label: "반려" },
  { value: "hold", label: "보류" }
];

export function ManualIssueForm({
  onSubmit,
  onClose,
  isSubmitting,
  error
}: ManualIssueFormProps): JSX.Element {
  const [title, setTitle] = useState("");
  const [riskLevel, setRiskLevel] = useState<RiskLevel>("caution");
  const [targetText, setTargetText] = useState("");
  const [description, setDescription] = useState("");
  const [suggestedAction, setSuggestedAction] =
    useState<ReviewIssue["suggestedAction"]>("change_request");
  const [suggestedCopy, setSuggestedCopy] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedTitle = title.trim();

    if (trimmedTitle.length === 0) {
      setValidationError("제목을 입력해 주세요.");
      return;
    }

    setValidationError(null);

    const trimmedTargetText = targetText.trim();
    const trimmedDescription = description.trim();
    const trimmedSuggestedCopy = suggestedCopy.trim();

    void onSubmit({
      title: trimmedTitle,
      riskLevel,
      suggestedAction,
      ...(trimmedTargetText ? { targetText: trimmedTargetText } : {}),
      ...(trimmedDescription ? { description: trimmedDescription } : {}),
      ...(trimmedSuggestedCopy ? { suggestedCopy: trimmedSuggestedCopy } : {})
    });
  }

  return (
    <div className={styles.backdrop} role="presentation" onClick={onClose}>
      <section
        className={`panel ${styles.modal}`}
        role="dialog"
        aria-modal="true"
        aria-label="이슈 직접 추가"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <div>
            <p className="eyebrow">Manual Issue</p>
            <h3>이슈 직접 추가</h3>
          </div>
          <button
            className="icon-button icon-button--small"
            type="button"
            aria-label="이슈 직접 추가 닫기"
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>제목</span>
            <input
              aria-label="이슈 제목"
              value={title}
              disabled={isSubmitting}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>

          <div className={styles.fieldRow}>
            <label className={styles.field}>
              <span>위험도</span>
              <select
                aria-label="이슈 위험도"
                value={riskLevel}
                disabled={isSubmitting}
                onChange={(event) => setRiskLevel(event.target.value as RiskLevel)}
              >
                {riskOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span>제안 조치</span>
              <select
                aria-label="제안 조치"
                value={suggestedAction}
                disabled={isSubmitting}
                onChange={(event) =>
                  setSuggestedAction(event.target.value as ReviewIssue["suggestedAction"])
                }
              >
                {actionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className={styles.field}>
            <span>지적 텍스트</span>
            <input
              aria-label="지적 텍스트"
              value={targetText}
              disabled={isSubmitting}
              onChange={(event) => setTargetText(event.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span>설명</span>
            <textarea
              aria-label="이슈 설명"
              value={description}
              disabled={isSubmitting}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span>제안 문구</span>
            <textarea
              aria-label="제안 문구"
              value={suggestedCopy}
              disabled={isSubmitting}
              onChange={(event) => setSuggestedCopy(event.target.value)}
            />
          </label>

          {validationError ? (
            <p className="interaction-error" role="alert">
              {validationError}
            </p>
          ) : null}
          {error ? (
            <p className="interaction-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className={styles.actions}>
            <button
              className="button"
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
            >
              취소
            </button>
            <button className="button button--primary" type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <LoaderCircle className="action-spinner" size={16} aria-hidden="true" />
                  추가 중
                </>
              ) : (
                "이슈 추가"
              )}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
