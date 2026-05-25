"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, FileCheck2, PackageSearch, TriangleAlert } from "lucide-react";
import {
  buildSamplePackagePreview,
  getRequiredMaterialRows,
  getSamplePackages
} from "@/domain/intake";

const fileTypeLabels: Record<string, string> = {
  promotional_creative: "홍보물 시안",
  copy_draft: "원문 카피",
  product_description: "상품 설명서",
  terms: "약관",
  rate_table: "금리표",
  checklist: "내부 체크리스트",
  internal_checklist: "내부 체크리스트",
  url_list: "URL 목록",
  misc: "기타"
};

const productLabels = {
  deposit: "예금/적금",
  loan: "대출",
  card: "카드",
  capital: "캐피탈",
  insurance: "보험",
  investment: "투자상품"
};

export function SamplePackageSelector() {
  const packages = getSamplePackages();
  const [selectedPackageId, setSelectedPackageId] = useState(packages[0]?.id);

  const preview = useMemo(
    () => (selectedPackageId ? buildSamplePackagePreview(selectedPackageId) : undefined),
    [selectedPackageId]
  );
  const materialRows = preview ? getRequiredMaterialRows(preview) : [];
  const representedMissingKeys = new Set(
    materialRows
      .filter((row) => row.status === "missing")
      .flatMap((row) => [
        row.fileType,
        row.fileType === "checklist" ? "internal_checklist" : row.fileType
      ])
  );
  const extraMissingMaterials =
    preview?.missingMaterials.filter((material) => !representedMissingKeys.has(material)) ?? [];

  return (
    <div className="intake-flow">
      <section className="panel intake-hero">
        <div>
          <p className="eyebrow">Review Request Intake</p>
          <h2>새 심의 요청</h2>
          <p>
            Demo MVP에서는 실제 업로드 대신 승인된 샘플 패키지를 선택해 자동 분류, 누락 자료, AI
            분석 시작 흐름을 안정적으로 시연합니다.
          </p>
        </div>
        <PackageSearch size={34} aria-hidden="true" />
      </section>

      <section className="intake-grid">
        <div className="panel panel--compact">
          <div className="section-heading">
            <p className="eyebrow">Sample Package</p>
            <h3>샘플 패키지를 선택하세요</h3>
          </div>

          <div className="sample-package-list">
            {packages.map((samplePackage) => (
              <button
                key={samplePackage.id}
                className="sample-package-card"
                data-active={selectedPackageId === samplePackage.id}
                type="button"
                aria-label={`${samplePackage.label} 선택`}
                onClick={() => setSelectedPackageId(samplePackage.id)}
              >
                <span>{samplePackage.highestRiskLabel}</span>
                <strong>{samplePackage.label}</strong>
                <small>{samplePackage.title}</small>
                <em>{samplePackage.summary}</em>
              </button>
            ))}
          </div>
        </div>

        {preview ? (
          <div className="intake-preview">
            <section className="panel panel--compact">
              <div className="panel__header">
                <div>
                  <p className="eyebrow">Request Summary</p>
                  <h3>{preview.title}</h3>
                </div>
                <span className="status-badge">{productLabels[preview.productType]}</span>
              </div>
              <dl className="summary-list">
                <div>
                  <dt>계열사</dt>
                  <dd>{preview.affiliate}</dd>
                </div>
                <div>
                  <dt>AI 위험 후보</dt>
                  <dd>{preview.issueCount}개</dd>
                </div>
              </dl>
            </section>

            <section className="panel panel--compact">
              <div className="panel__header">
                <div>
                  <p className="eyebrow">Classification</p>
                  <h3>파일 자동 분류 결과</h3>
                </div>
                <FileCheck2 size={20} aria-hidden="true" />
              </div>

              <div className="classification-list">
                {preview.files.map((file) => (
                  <article key={file.id} className="classification-row">
                    <div>
                      <strong>{file.name}</strong>
                      <span>{fileTypeLabels[file.fileType]}</span>
                    </div>
                    <em>{Math.round(file.classificationConfidence * 100)}%</em>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel panel--compact">
              <div className="panel__header">
                <div>
                  <p className="eyebrow">Required Materials</p>
                  <h3>필수 자료 확인</h3>
                </div>
                <TriangleAlert size={20} aria-hidden="true" />
              </div>

              <div className="materials-grid">
                {materialRows.map((row) => (
                  <div key={row.fileType} className="material-row" data-status={row.status}>
                    {row.status === "present" ? (
                      <CheckCircle2 size={16} aria-hidden="true" />
                    ) : (
                      <TriangleAlert size={16} aria-hidden="true" />
                    )}
                    <span>{row.label}</span>
                    <strong>{row.status === "present" ? "있음" : "없음"}</strong>
                  </div>
                ))}
              </div>

              {extraMissingMaterials.length > 0 ? (
                <div className="missing-material-strip" aria-label="Additional missing materials">
                  {extraMissingMaterials.map((material) => (
                    <span key={material}>{fileTypeLabels[material] ?? material}</span>
                  ))}
                </div>
              ) : null}

              <Link
                className="button button--primary intake-start"
                href={preview.analysisStartHref}
              >
                AI 분석 시작
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </section>
          </div>
        ) : null}
      </section>
    </div>
  );
}
