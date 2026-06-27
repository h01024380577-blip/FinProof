"use client";

import { useEffect, useRef, useState, type JSX } from "react";
import { Download, Loader2 } from "lucide-react";
import { productLabels } from "@/domain/reviews";
import type { ReviewCertificate } from "@/domain/types";
import styles from "./CertificateDocument.module.css";

type ApiHeaders = (extra?: Record<string, string>) => Record<string, string>;

type CertificateState =
  | { kind: "loading" }
  | { kind: "ready"; certificate: ReviewCertificate }
  | { kind: "not_issued" }
  | { kind: "error"; message: string };

function formatDateOnly(value?: string): string {
  if (!value) return "-";
  const separatorIndex = value.indexOf("T");
  return separatorIndex > 0 ? value.slice(0, separatorIndex) : value;
}

/**
 * Inlined FinProof shield mark (public/finproof-mark.svg) used as the certificate
 * watermark. Inlining keeps it part of the captured DOM so it appears in the PDF.
 */
function CertificateWatermark(): JSX.Element {
  return (
    <div className={styles.watermark} aria-hidden="true">
      <svg viewBox="0 0 210 210" fill="none" xmlns="http://www.w3.org/2000/svg" focusable="false">
        <defs>
          <linearGradient
            id="finproofCertShield"
            x1="54"
            y1="28"
            x2="160"
            y2="155"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#031B4E" />
            <stop offset="0.58" stopColor="#0A367A" />
            <stop offset="1" stopColor="#0E6BDB" />
          </linearGradient>
          <linearGradient
            id="finproofCertCheck"
            x1="122"
            y1="123"
            x2="178"
            y2="87"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#1B8A80" />
            <stop offset="1" stopColor="#36C2A5" />
          </linearGradient>
        </defs>
        <path
          d="M104.4 16L169.1 46.2C173.4 48.2 176.2 52.6 176.2 57.3V88.4L161.1 103.4V66.1C161.1 62.7 159.1 59.6 156 58.2L104.4 34.3L53 58.1C49.9 59.5 47.9 62.6 47.9 66V101C47.9 121.4 59.2 140.2 77.3 149.9L104.4 164.4L118.7 156.7L128.6 169.3L104.4 182L69.9 163.6C46.8 151.3 32.4 127.2 32.4 101V57.3C32.4 52.6 35.2 48.2 39.5 46.2L104.4 16Z"
          fill="url(#finproofCertShield)"
        />
        <path d="M78 96.7L96.2 87.2V134.7L78 125.1V96.7Z" fill="#08245C" />
        <path d="M107 77.1L127.2 66.5V118.5L107 139V77.1Z" fill="#1465F4" />
        <path
          d="M102.3 146.4L133.7 114.7L176.2 72.3V95.6L119.4 153.8L102.3 146.4Z"
          fill="url(#finproofCertCheck)"
        />
      </svg>
    </div>
  );
}

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
      <div id="certificate-printable" ref={printableRef} className={styles.printable}>
        <CertificateWatermark />
        <div className={styles.content}>
          <div className={styles.header}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.logo} src="/finproof-logo.svg" alt="FinProof" />
            <h2 className={styles.title}>심의필</h2>
          </div>

          <span className={styles.numberRow}>
            <span className={styles.numberLabel}>심의필 번호</span>
            <span className={styles.numberValue}>{certificate.certificateNumber}</span>
          </span>

          <dl className={styles.metaGrid}>
            <dt className={styles.metaLabel}>케이스</dt>
            <dd className={styles.metaValue}>{meta.title}</dd>
            <dt className={styles.metaLabel}>상품유형</dt>
            <dd className={styles.metaValue}>
              {meta.productType ? productLabels[meta.productType] : "-"}
            </dd>
            <dt className={styles.metaLabel}>승인일</dt>
            <dd className={styles.metaValue}>{formatDateOnly(meta.approvedAt)}</dd>
            <dt className={styles.metaLabel}>심의자</dt>
            <dd className={styles.metaValue}>{reviewerName}</dd>
          </dl>

          <p className={styles.body}>{certificate.body}</p>

          <div className={styles.footer}>
            <span className={styles.footerItem}>
              <span className={styles.footerLabel}>발급자</span>
              {certificate.issuedByName || "-"}
            </span>
            <span className={styles.footerItem}>
              <span className={styles.footerLabel}>발급일</span>
              {formatDateOnly(certificate.issuedAt)}
            </span>
          </div>
        </div>
      </div>

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
