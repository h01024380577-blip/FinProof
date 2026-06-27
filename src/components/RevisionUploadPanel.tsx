"use client";

import { useState, type JSX } from "react";
import { LoaderCircle } from "lucide-react";
import { IntakeUploadZone } from "./intake/IntakeUploadZone";
import styles from "./RevisionUploadPanel.module.css";

type ApiHeaders = (extra?: Record<string, string>) => Record<string, string>;

export type RevisionUploadPanelProps = {
  caseId: string;
  apiHeaders: ApiHeaders;
  onSuccess: () => void;
};

function revisionErrorMessage(status: number): string {
  if (status === 409) {
    return "현재 상태에서는 재검토를 요청할 수 없습니다.";
  }
  if (status === 400) {
    return "업로드할 파일이 없거나 안전하지 않은 파일입니다. 파일을 다시 확인해 주세요.";
  }
  if (status === 403) {
    return "재검토 요청 권한이 없습니다.";
  }
  return "재검토 요청을 처리하지 못했습니다.";
}

export function RevisionUploadPanel({
  caseId,
  apiHeaders,
  onSuccess
}: RevisionUploadPanelProps): JSX.Element {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function handleSubmit(): Promise<void> {
    if (files.length === 0) {
      setError("재업로드할 파일을 선택해 주세요.");
      return;
    }

    setError(null);
    setSuccessMessage(null);
    setIsSubmitting(true);

    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));

    try {
      const response = await fetch(
        `/api/v1/review-cases/${encodeURIComponent(caseId)}/revisions`,
        {
          method: "POST",
          headers: apiHeaders(),
          body: formData
        }
      );

      if (!response.ok) {
        setError(revisionErrorMessage(response.status));
        return;
      }

      setFiles([]);
      setSuccessMessage("재검토 요청이 접수되었습니다.");
      onSuccess();
    } catch {
      setError("재검토 요청을 처리하지 못했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className={styles.panel} aria-label="수정본 재업로드">
      <p className={styles.panelHeading}>수정본 재업로드</p>

      <IntakeUploadZone
        files={files}
        onFilesChange={(next) => {
          setFiles(next);
          setSuccessMessage(null);
        }}
        error={error}
        onError={setError}
      />

      {successMessage ? (
        <p className={styles.notice} role="status">
          {successMessage}
        </p>
      ) : null}

      <div className={styles.actions}>
        <button
          type="button"
          className="button button--primary"
          onClick={() => void handleSubmit()}
          disabled={isSubmitting || files.length === 0}
        >
          {isSubmitting ? (
            <>
              <LoaderCircle className="action-spinner" size={16} aria-hidden="true" />
              재업로드 중
            </>
          ) : (
            "재업로드"
          )}
        </button>
      </div>
    </div>
  );
}
