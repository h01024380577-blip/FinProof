"use client";

import { forwardRef, type JSX } from "react";
import { productLabels } from "@/domain/reviews";
import type { ProductType } from "@/domain/types";
import styles from "./CertificateDocument.module.css";

function formatDateOnly(value?: string): string {
  if (!value) return "-";
  const separatorIndex = value.indexOf("T");
  return separatorIndex > 0 ? value.slice(0, separatorIndex) : value;
}

/**
 * Inlined FinProof shield mark (public/finproof-mark.svg) used as the certificate
 * watermark. Inlining keeps it part of the captured DOM so it appears in the PDF.
 */
export function CertificateWatermark(): JSX.Element {
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

export type CertificatePreviewProps = {
  id?: string;
  certificateNumber: string;
  title: string;
  productType?: ProductType;
  approvedAt?: string;
  reviewerName: string;
  validFrom?: string;
  validUntil?: string;
  remarks?: string;
  body: string;
  bodyPlaceholder?: string;
  issuedByName?: string;
  issuedAt?: string;
};

/**
 * Presentational, paper-like 심의필 document used both for the requester download
 * (CertificateDocument) and the reviewer live preview (CertificateEditor). Receives all
 * content as props so it re-renders instantly as the reviewer types.
 */
export const CertificatePreview = forwardRef<HTMLDivElement, CertificatePreviewProps>(
  function CertificatePreview(
    {
      id,
      certificateNumber,
      title,
      productType,
      approvedAt,
      reviewerName,
      validFrom,
      validUntil,
      remarks,
      body,
      bodyPlaceholder,
      issuedByName,
      issuedAt
    },
    ref
  ): JSX.Element {
    const hasBody = body.trim().length > 0;
    const hasRemarks = (remarks ?? "").trim().length > 0;
    const validityRange = `${formatDateOnly(validFrom)} ~ ${formatDateOnly(validUntil)}`;

    return (
      <div id={id} ref={ref} className={styles.printable}>
        <CertificateWatermark />
        <div className={styles.content}>
          <div className={styles.header}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.logo} src="/finproof-logo.svg" alt="FinProof" />
            <h2 className={styles.title}>심의필</h2>
          </div>

          <span className={styles.numberRow}>
            <span className={styles.numberLabel}>심의필 번호</span>
            <span className={styles.numberValue}>{certificateNumber}</span>
          </span>

          <dl className={styles.metaGrid}>
            <dt className={styles.metaLabel}>케이스</dt>
            <dd className={styles.metaValue}>{title}</dd>
            <dt className={styles.metaLabel}>상품유형</dt>
            <dd className={styles.metaValue}>{productType ? productLabels[productType] : "-"}</dd>
            <dt className={styles.metaLabel}>유효기간</dt>
            <dd className={styles.metaValue}>{validityRange}</dd>
            <dt className={styles.metaLabel}>승인일</dt>
            <dd className={styles.metaValue}>{formatDateOnly(approvedAt)}</dd>
            <dt className={styles.metaLabel}>심의자</dt>
            <dd className={styles.metaValue}>{reviewerName || "-"}</dd>
          </dl>

          {hasBody ? (
            <p className={styles.body}>{body}</p>
          ) : (
            <p className={styles.body} style={{ color: "#9aa3b2" }}>
              {bodyPlaceholder ?? "심의 의견 및 부가 조건이 여기에 표시됩니다."}
            </p>
          )}

          {hasRemarks ? (
            <div className={styles.remarks}>
              <span className={styles.remarksLabel}>심의 의견</span>
              <p className={styles.remarksText}>{remarks}</p>
            </div>
          ) : null}

          <div className={styles.footer}>
            <span className={styles.footerItem}>
              <span className={styles.footerLabel}>발급자</span>
              {issuedByName || "-"}
            </span>
            <span className={styles.footerItem}>
              <span className={styles.footerLabel}>발급일</span>
              {formatDateOnly(issuedAt)}
            </span>
          </div>
        </div>
      </div>
    );
  }
);
