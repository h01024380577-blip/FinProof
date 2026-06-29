"use client";

import { useEffect, useRef, useState, type JSX } from "react";
import { Download, Loader2 } from "lucide-react";
import type { ReviewCertificate } from "@/domain/types";
import { CertificatePreview } from "./CertificatePreview";
import styles from "./CertificateDocument.module.css";

type ApiHeaders = (extra?: Record<string, string>) => Record<string, string>;

type CertificateState =
  | { kind: "loading" }
  | { kind: "ready"; certificate: ReviewCertificate }
  | { kind: "not_issued" }
  | { kind: "error"; message: string };

export function CertificateDocument({
  caseId,
  apiHeaders
}: {
  caseId: string;
  apiHeaders: ApiHeaders;
}): JSX.Element {
  const [state, setState] = useState<CertificateState>({ kind: "loading" });
  const [isGenerating, setIsGenerating] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const printableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;

    async function loadCertificate(): Promise<void> {
      if (mounted) setState({ kind: "loading" });

      try {
        const response = await fetch(
          `/api/v1/review-cases/${encodeURIComponent(caseId)}/certificate`,
          { headers: apiHeaders() }
        );

        if (!mounted) return;

        if (response.status === 404) {
          setState({ kind: "not_issued" });
          return;
        }

        if (response.status === 403) {
          setState({ kind: "error", message: "심의필을 볼 권한이 없습니다." });
          return;
        }

        if (!response.ok) {
          setState({ kind: "error", message: "심의필을 불러오지 못했습니다." });
          return;
        }

        const body = (await response.json()) as { certificate?: ReviewCertificate };

        if (!mounted) return;

        if (!body.certificate) {
          setState({ kind: "not_issued" });
          return;
        }

        setState({ kind: "ready", certificate: body.certificate });
      } catch {
        if (mounted) {
          setState({ kind: "error", message: "심의필을 불러오지 못했습니다." });
        }
      }
    }

    void loadCertificate();

    return () => {
      mounted = false;
    };
  }, [caseId, apiHeaders]);

  async function handleDownload(): Promise<void> {
    if (isGenerating || state.kind !== "ready") return;
    const node = printableRef.current;
    if (!node) return;

    setIsGenerating(true);
    setDownloadError(null);

    try {
      const { jsPDF } = await import("jspdf");
      const html2canvas = (await import("html2canvas")).default;

      const canvas = await html2canvas(node, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height / canvas.width) * imgWidth;

      pdf.addImage(imgData, "PNG", 0, 0, imgWidth, imgHeight);
      pdf.save(`심의필_${state.certificate.certificateNumber}.pdf`);
    } catch {
      setDownloadError("PDF 생성에 실패했습니다.");
    } finally {
      setIsGenerating(false);
    }
  }

  if (state.kind === "loading") {
    return (
      <p className={styles.stateText} role="status">
        <Loader2 className="action-spinner" size={16} aria-hidden="true" />
        심의필을 불러오는 중입니다.
      </p>
    );
  }

  if (state.kind === "not_issued") {
    return <p className={styles.stateText}>심의필 발급 전입니다.</p>;
  }

  if (state.kind === "error") {
    return (
      <p className={`${styles.stateText} ${styles.stateError}`} role="alert">
        {state.message}
      </p>
    );
  }

  const { certificate } = state;
  const meta = certificate.metadata;
  const reviewerName = meta.reviewerName || certificate.issuedByName || "-";

  return (
    <div className={styles.wrapper}>
      <CertificatePreview
        id="certificate-printable"
        ref={printableRef}
        certificateNumber={certificate.certificateNumber}
        title={meta.title}
        productType={meta.productType}
        approvedAt={meta.approvedAt}
        reviewerName={reviewerName}
        validFrom={certificate.validFrom}
        validUntil={certificate.validUntil}
        remarks={certificate.remarks}
        body={certificate.body}
        issuedByName={certificate.issuedByName}
        issuedAt={certificate.issuedAt}
      />

      <div className={styles.actions}>
        {downloadError ? (
          <p className={styles.downloadError} role="alert">
            {downloadError}
          </p>
        ) : null}
        <button
          type="button"
          className="button button--primary"
          onClick={() => void handleDownload()}
          disabled={isGenerating}
          aria-busy={isGenerating}
        >
          {isGenerating ? (
            <>
              <Loader2 className="action-spinner" size={16} aria-hidden="true" />
              PDF 생성 중
            </>
          ) : (
            <>
              <Download size={16} aria-hidden="true" />
              심의필 PDF 다운로드
            </>
          )}
        </button>
      </div>
    </div>
  );
}
