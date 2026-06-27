"use client";

import { useEffect, useRef, useState, type FormEvent, type JSX } from "react";
import { LoaderCircle, X } from "lucide-react";
import { productLabels } from "@/domain/reviews";
import type { ReviewCertificate } from "@/domain/types";
import styles from "./CertificateEditorModal.module.css";

export type CertificateEditorModalProps = {
  caseId: string;
  title: string;
  affiliateName: string;
  apiHeaders: (extra?: Record<string, string>) => Record<string, string>;
  onClose: () => void;
};

type CertificateResponse = {
  certificate?: ReviewCertificate;
};

function formatDateTime(value: string | undefined): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function productLabel(productType: ReviewCertificate["metadata"]["productType"] | undefined): string {
  if (!productType) {
    return "-";
  }

  return productLabels[productType] ?? productType;
}

export function CertificateEditorModal({
  caseId,
  title,
  affiliateName,
  apiHeaders,
  onClose
}: CertificateEditorModalProps): JSX.Element {
  const [isLoading, setIsLoading] = useState(true);
  const [certificate, setCertificate] = useState<ReviewCertificate | null>(null);
  const [body, setBody] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/v1/review-cases/${caseId}/certificate`, {
          headers: apiHeaders()
        });

        if (!mounted) {
          return;
        }

        if (response.status === 404) {
          // 아직 발급되지 않은 케이스 — 본문은 비워두고 행 메타데이터를 사용한다.
          setCertificate(null);
          setBody("");
          return;
        }

        if (!response.ok) {
          throw new Error("심의필 정보를 불러오지 못했습니다.");
        }

        const payload = (await response.json()) as CertificateResponse;

        if (payload.certificate) {
          setCertificate(payload.certificate);
          setBody(payload.certificate.body ?? "");
        }
      } catch (loadError) {
        if (mounted) {
          setError(
            loadError instanceof Error ? loadError.message : "심의필 정보를 불러오지 못했습니다."
          );
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [apiHeaders, caseId]);

  useEffect(() => {
    if (!isLoading) {
      textareaRef.current?.focus();
    }
  }, [isLoading]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const trimmed = body.trim();

    if (!trimmed) {
      setError("심의 의견 본문을 입력해 주세요.");
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch(`/api/v1/review-cases/${caseId}/certificate`, {
        method: "POST",
        headers: apiHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ body: trimmed })
      });

      if (!response.ok) {
        if (response.status === 400) {
          throw new Error("심의 의견 본문을 입력해 주세요.");
        }
        if (response.status === 409) {
          throw new Error("승인된 케이스만 심의필을 발급할 수 있습니다.");
        }
        if (response.status === 403) {
          throw new Error("심의필을 발급할 권한이 없습니다.");
        }
        throw new Error("심의필 발급 요청을 처리하지 못했습니다.");
      }

      const payload = (await response.json()) as CertificateResponse;

      if (payload.certificate) {
        setCertificate(payload.certificate);
        setBody(payload.certificate.body ?? trimmed);
        setSuccessMessage(`심의필 ${payload.certificate.certificateNumber} 발급이 완료되었습니다.`);
      } else {
        setSuccessMessage("심의필 발급이 완료되었습니다.");
      }
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "심의필 발급 요청을 처리하지 못했습니다."
      );
    } finally {
      setIsSaving(false);
    }
  }

  const metadata = certificate?.metadata;
  const displayTitle = metadata?.title ?? title;
  const displayAffiliate = metadata?.affiliateName ?? affiliateName;
  const certificateNumber = certificate?.certificateNumber ?? "미발급";
  const submitLabel = certificate ? "저장" : "발급";

  return (
    <div className={styles.backdrop} role="presentation" onClick={onClose}>
      <section
        className={`panel ${styles.modal}`}
        role="dialog"
        aria-modal="true"
        aria-label="심의필 발급"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <div>
            <p className="eyebrow">심의필</p>
            <h3>심의 완료 증명서</h3>
          </div>
          <button
            className="icon-button icon-button--small"
            type="button"
            aria-label="심의필 발급 닫기"
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {isLoading ? (
          <p className={styles.loading}>
            <LoaderCircle className="action-spinner" size={16} aria-hidden="true" />
            심의필 정보를 불러오는 중입니다.
          </p>
        ) : (
          <>
            <dl className={styles.meta} aria-label="심의필 자동 메타데이터">
              <div className={styles.metaRow}>
                <dt>증명서 번호</dt>
                <dd>{certificateNumber}</dd>
              </div>
              <div className={styles.metaRow}>
                <dt>심의 건명</dt>
                <dd>{displayTitle}</dd>
              </div>
              <div className={styles.metaRow}>
                <dt>제휴사</dt>
                <dd>{displayAffiliate || "-"}</dd>
              </div>
              {metadata ? (
                <>
                  <div className={styles.metaRow}>
                    <dt>상품군</dt>
                    <dd>{productLabel(metadata.productType)}</dd>
                  </div>
                  <div className={styles.metaRow}>
                    <dt>승인일</dt>
                    <dd>{formatDateTime(metadata.approvedAt)}</dd>
                  </div>
                  <div className={styles.metaRow}>
                    <dt>심의자</dt>
                    <dd>{metadata.reviewerName || "-"}</dd>
                  </div>
                </>
              ) : null}
              {certificate ? (
                <div className={styles.metaRow}>
                  <dt>발급</dt>
                  <dd>
                    {certificate.issuedByName ? `${certificate.issuedByName} · ` : ""}
                    {formatDateTime(certificate.issuedAt)}
                  </dd>
                </div>
              ) : null}
            </dl>

            <form className={styles.form} onSubmit={(event) => void handleSubmit(event)}>
              <label className={styles.field}>
                <span>심의 의견 · 부가 조건</span>
                <textarea
                  ref={textareaRef}
                  className={styles.textarea}
                  aria-label="심의 의견 본문"
                  value={body}
                  disabled={isSaving}
                  placeholder="심의 의견 및 부가 조건을 자유롭게 작성해 주세요."
                  onChange={(event) => setBody(event.target.value)}
                />
              </label>

              {error ? (
                <p className="interaction-error" role="alert">
                  {error}
                </p>
              ) : null}

              {successMessage ? (
                <p className={styles.success} role="status">
                  {successMessage}
                </p>
              ) : null}

              <div className={styles.actions}>
                <button className="button button--small" type="button" onClick={onClose}>
                  닫기
                </button>
                <button
                  className="button button--small button--primary"
                  type="submit"
                  disabled={isSaving || body.trim().length === 0}
                >
                  {isSaving ? (
                    <>
                      <LoaderCircle className="action-spinner" size={15} aria-hidden="true" />
                      처리 중
                    </>
                  ) : (
                    submitLabel
                  )}
                </button>
              </div>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
