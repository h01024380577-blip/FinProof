"use client";

import { useEffect, useState, type JSX } from "react";
import { LoaderCircle } from "lucide-react";
import type { ProductType, ReviewCase, ReviewCertificate } from "@/domain/types";
import { CertificatePreview } from "../CertificatePreview";
import styles from "./CertificateEditor.module.css";

export type CertificateDraft = {
  body: string;
  certificateNumber: string;
  validFrom: string;
  validUntil: string;
  remarks: string;
};

export type CertificateEditorProps = {
  caseId: string;
  title: string;
  issuerName: string;
  productType?: ProductType;
  reviewerName: string;
  reviewStatus: ReviewCase["status"];
  canMutate: boolean;
  apiHeaders: (extra?: Record<string, string>) => Record<string, string>;
  draft: CertificateDraft;
  onDraftChange: (next: CertificateDraft) => void;
};

type CertificateResponse = {
  certificate?: ReviewCertificate;
};

function dateOnly(value?: string): string {
  if (!value) return "";
  const separatorIndex = value.indexOf("T");
  return separatorIndex > 0 ? value.slice(0, separatorIndex) : value;
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function addOneYear(dateStr: string): string {
  if (!dateStr) return "";
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setFullYear(parsed.getFullYear() + 1);
  return parsed.toISOString().slice(0, 10);
}

export function CertificateEditor({
  caseId,
  title,
  issuerName,
  productType,
  reviewerName,
  reviewStatus,
  canMutate,
  apiHeaders,
  draft,
  onDraftChange
}: CertificateEditorProps): JSX.Element {
  const [isLoading, setIsLoading] = useState(true);
  const [certificate, setCertificate] = useState<ReviewCertificate | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

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
          // 아직 발급되지 않은 케이스 — 본문은 유지하고 유효기간 기본값만 1회 시드한다.
          setCertificate(null);
          if (
            !draft.certificateNumber &&
            !draft.validFrom &&
            !draft.validUntil &&
            !draft.remarks
          ) {
            const validFrom = todayDate();
            onDraftChange({
              ...draft,
              validFrom,
              validUntil: addOneYear(validFrom)
            });
          }
          return;
        }

        if (!response.ok) {
          throw new Error("심의필 정보를 불러오지 못했습니다.");
        }

        const payload = (await response.json()) as CertificateResponse;

        if (payload.certificate) {
          const issued = payload.certificate;
          setCertificate(issued);
          const approvalDate = dateOnly(issued.metadata?.approvedAt) || todayDate();
          const validFrom = issued.validFrom ? dateOnly(issued.validFrom) : approvalDate;
          const validUntil = issued.validUntil
            ? dateOnly(issued.validUntil)
            : addOneYear(validFrom);
          onDraftChange({
            body: issued.body ?? "",
            certificateNumber: issued.certificateNumber ?? "",
            validFrom,
            validUntil,
            remarks: issued.remarks ?? ""
          });
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
    // The draft is lifted in the workspace and seeded once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiHeaders, caseId]);

  function updateField<K extends keyof CertificateDraft>(
    key: K,
    value: CertificateDraft[K]
  ): void {
    onDraftChange({ ...draft, [key]: value });
  }

  async function issueCertificate(): Promise<void> {
    const trimmedBody = draft.body.trim();
    const trimmedNumber = draft.certificateNumber.trim();

    if (!trimmedBody) {
      setError("심의 의견 본문을 입력해 주세요.");
      return;
    }

    if (!trimmedNumber) {
      setError("심의필 번호를 입력해 주세요.");
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch(`/api/v1/review-cases/${caseId}/certificate`, {
        method: "POST",
        headers: apiHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          body: trimmedBody,
          certificateNumber: trimmedNumber,
          validFrom: draft.validFrom,
          validUntil: draft.validUntil,
          remarks: draft.remarks
        })
      });

      if (!response.ok) {
        if (response.status === 400) {
          throw new Error("심의 의견 본문과 심의필 번호를 입력해 주세요.");
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
        const issued = payload.certificate;
        setCertificate(issued);
        const approvalDate = dateOnly(issued.metadata?.approvedAt) || draft.validFrom || todayDate();
        const validFrom = issued.validFrom ? dateOnly(issued.validFrom) : approvalDate;
        const validUntil = issued.validUntil
          ? dateOnly(issued.validUntil)
          : draft.validUntil || addOneYear(validFrom);
        onDraftChange({
          body: issued.body ?? trimmedBody,
          certificateNumber: issued.certificateNumber ?? trimmedNumber,
          validFrom,
          validUntil,
          remarks: issued.remarks ?? draft.remarks
        });
        setSuccessMessage(`심의필 ${issued.certificateNumber} 발급이 완료되었습니다.`);
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
  const previewNumber = draft.certificateNumber.trim() || "발급 예정";
  const isApproved = reviewStatus === "approved";
  const submitLabel = certificate ? "저장" : "발급";
  const canIssue =
    isApproved && canMutate && draft.body.trim().length > 0 && draft.certificateNumber.trim().length > 0;

  return (
    <div className="panel panel--compact drawer-support-panel">
      <div className="panel__header">
        <div>
          <p className="eyebrow">심의필</p>
          <h3>심의 완료 증명서</h3>
        </div>
        {canMutate ? (
          <button
            className="button button--small button--primary"
            type="button"
            disabled={isSaving || !canIssue}
            onClick={() => void issueCertificate()}
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
        ) : null}
      </div>

      {isLoading ? (
        <p className={styles.loading}>
          <LoaderCircle className="action-spinner" size={16} aria-hidden="true" />
          심의필 정보를 불러오는 중입니다.
        </p>
      ) : (
        <div className={styles.layout}>
          <section className={styles.editorPane} aria-label="심의필 작성">
            {canMutate ? (
              <form
                className={styles.form}
                onSubmit={(event) => {
                  event.preventDefault();
                  void issueCertificate();
                }}
              >
                <fieldset className={styles.issueInfo}>
                  <legend className={styles.issueInfoLegend}>발급 정보</legend>

                  <label className={styles.field}>
                    <span>심의필 번호</span>
                    <input
                      className={styles.input}
                      type="text"
                      aria-label="심의필 번호"
                      value={draft.certificateNumber}
                      disabled={isSaving}
                      placeholder="사내 시스템에서 발급된 번호를 입력하세요 (예: 2026-0605-001)"
                      onChange={(event) => updateField("certificateNumber", event.target.value)}
                    />
                    <p className={styles.hint}>형식: YYYY-MMDD-NNN</p>
                  </label>

                  <div className={styles.field}>
                    <span>유효기간</span>
                    <div className={styles.dateRange}>
                      <input
                        className={styles.input}
                        type="date"
                        aria-label="유효기간 시작"
                        value={draft.validFrom}
                        disabled={isSaving}
                        onChange={(event) => updateField("validFrom", event.target.value)}
                      />
                      <span className={styles.dateRangeSep} aria-hidden="true">
                        ~
                      </span>
                      <input
                        className={styles.input}
                        type="date"
                        aria-label="유효기간 종료"
                        value={draft.validUntil}
                        disabled={isSaving}
                        onChange={(event) => updateField("validUntil", event.target.value)}
                      />
                    </div>
                    <p className={styles.hint}>기본 유효기간은 1년이며, 필요 시 단축 가능합니다.</p>
                  </div>

                  <label className={styles.field}>
                    <span>심의 의견</span>
                    <textarea
                      className={styles.remarks}
                      aria-label="심의 의견"
                      value={draft.body}
                      disabled={isSaving}
                      placeholder="심의 의견을 자유롭게 작성해 주세요."
                      onChange={(event) => updateField("body", event.target.value)}
                    />
                  </label>
                </fieldset>

                {!isApproved ? (
                  <p className={styles.hint}>
                    승인 후 심의필을 발급할 수 있습니다. (승인 시 작성한 내용이 자동 발급됩니다.)
                  </p>
                ) : null}

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
              </form>
            ) : (
              <p className={styles.readonlyBody}>
                {draft.body.trim() || "발급된 심의필 본문이 없습니다."}
              </p>
            )}
          </section>

          <section className={styles.previewPane} aria-label="심의필 미리보기">
            <p className={styles.paneLabel}>실시간 미리보기</p>
            <CertificatePreview
              certificateNumber={previewNumber}
              title={displayTitle}
              productType={metadata?.productType ?? productType}
              approvedAt={metadata?.approvedAt}
              reviewerName={metadata?.reviewerName ?? reviewerName}
              validFrom={draft.validFrom}
              validUntil={draft.validUntil}
              remarks={draft.remarks}
              body={draft.body}
              bodyPlaceholder="작성하신 심의 의견이 여기에 실시간으로 반영됩니다."
              issuedByName={certificate?.issuedByName ?? issuerName}
              issuedAt={certificate?.issuedAt}
            />
          </section>
        </div>
      )}
    </div>
  );
}
