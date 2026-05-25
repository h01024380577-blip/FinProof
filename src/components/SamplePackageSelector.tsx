"use client";

import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  FileCheck2,
  PackageSearch,
  TriangleAlert,
  Upload
} from "lucide-react";
import {
  buildSamplePackagePreview,
  getRequiredMaterialRows,
  getSamplePackages,
  type RequiredMaterialRow
} from "@/domain/intake";
import {
  formatUploadPolicySummary,
  uploadAcceptAttribute,
  validateUploadedFiles
} from "@/domain/upload-policy";
import type { ProductType, ReviewFile } from "@/domain/types";

type IntakeMode = "sample" | "upload";

type UploadResult = {
  reviewCase: {
    id: string;
    title: string;
    productType: ProductType;
  };
  files: ReviewFile[];
  missingMaterials: string[];
  analysisStartHref: string;
};

type UploadAnalysisResult = {
  reviewCaseId: string;
  status: "analysis_complete";
  analysisHref: string;
  analysisNotice?: string;
};

const fileTypeLabels: Record<string, string> = {
  promotional_creative: "홍보물 시안",
  copy_draft: "원문 카피",
  product_description: "상품 설명서",
  terms: "약관",
  rate_table: "금리표",
  checklist: "내부 체크리스트",
  internal_checklist: "내부 체크리스트",
  url_list: "URL 목록",
  package_archive: "압축 패키지",
  misc: "기타"
};

const productLabels: Record<ProductType, string> = {
  deposit: "예금/적금",
  loan: "대출",
  card: "카드",
  capital: "캐피탈",
  insurance: "보험",
  investment: "투자상품"
};

function getRepresentedMissingKeys(materialRows: RequiredMaterialRow[]): Set<string> {
  return new Set(
    materialRows
      .filter((row) => row.status === "missing")
      .flatMap((row) => [
        row.fileType,
        row.fileType === "checklist" ? "internal_checklist" : row.fileType
      ])
  );
}

function getExtraMissingMaterials(
  missingMaterials: string[],
  materialRows: RequiredMaterialRow[]
): string[] {
  const representedMissingKeys = getRepresentedMissingKeys(materialRows);

  return missingMaterials.filter((material) => !representedMissingKeys.has(material));
}

export function SamplePackageSelector() {
  const packages = getSamplePackages();
  const [mode, setMode] = useState<IntakeMode>("sample");
  const [selectedPackageId, setSelectedPackageId] = useState(packages[0]?.id);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadProductType, setUploadProductType] = useState<ProductType>("deposit");
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploadAnalysis, setUploadAnalysis] = useState<UploadAnalysisResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isStartingAnalysis, setIsStartingAnalysis] = useState(false);

  const preview = useMemo(
    () => (selectedPackageId ? buildSamplePackagePreview(selectedPackageId) : undefined),
    [selectedPackageId]
  );
  const sampleMaterialRows = preview ? getRequiredMaterialRows(preview) : [];
  const sampleExtraMissingMaterials = preview
    ? getExtraMissingMaterials(preview.missingMaterials, sampleMaterialRows)
    : [];
  const uploadMaterialRows = uploadResult
    ? getRequiredMaterialRows({
        productType: uploadResult.reviewCase.productType,
        files: uploadResult.files
      })
    : [];
  const uploadExtraMissingMaterials = uploadResult
    ? getExtraMissingMaterials(uploadResult.missingMaterials, uploadMaterialRows)
    : [];

  async function submitUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploadError(null);
    setUploadAnalysis(null);

    if (uploadFiles.length === 0) {
      setUploadError("업로드할 파일을 선택해 주세요.");
      return;
    }

    const validation = validateUploadedFiles(uploadFiles);

    if (!validation.ok) {
      setUploadError(validation.errors[0]);
      return;
    }

    const formData = new FormData();
    formData.set("title", uploadTitle);
    formData.set("affiliate", "광주은행");
    formData.set("productType", uploadProductType);
    formData.append("channelType", "poster");
    formData.set("plannedPublishDate", "2026-06-20");
    uploadFiles.forEach((file) => formData.append("files", file));

    setIsUploading(true);
    try {
      const response = await fetch("/api/v1/review-cases", {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        throw new Error("업로드 요청을 처리하지 못했습니다.");
      }

      setUploadResult((await response.json()) as UploadResult);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "업로드 요청을 처리하지 못했습니다.");
    } finally {
      setIsUploading(false);
    }
  }

  async function startUploadedAnalysis() {
    if (!uploadResult) {
      return;
    }

    setIsStartingAnalysis(true);
    setUploadError(null);
    try {
      const response = await fetch(uploadResult.analysisStartHref, {
        method: "POST"
      });

      if (!response.ok) {
        throw new Error("분석 시작 요청을 처리하지 못했습니다.");
      }

      setUploadAnalysis((await response.json()) as UploadAnalysisResult);
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "분석 시작 요청을 처리하지 못했습니다."
      );
    } finally {
      setIsStartingAnalysis(false);
    }
  }

  return (
    <div className="intake-flow">
      <section className="panel intake-hero">
        <div>
          <p className="eyebrow">Review Request Intake</p>
          <h2>새 심의 요청</h2>
          <p>
            Demo MVP에서는 승인된 샘플 패키지와 제한된 실제 파일 업로드를 모두 지원합니다. 실제
            업로드는 파일 수신, 자동 분류, 누락 자료 확인까지 처리합니다.
          </p>
        </div>
        <PackageSearch size={34} aria-hidden="true" />
      </section>

      <section className="intake-grid">
        <div className="panel panel--compact">
          <div className="section-heading">
            <p className="eyebrow">Intake Source</p>
            <h3>{mode === "sample" ? "샘플 패키지를 선택하세요" : "실제 자료 업로드"}</h3>
          </div>

          <div className="intake-mode-tabs" aria-label="Intake mode">
            <button
              type="button"
              className="chip"
              data-active={mode === "sample"}
              onClick={() => setMode("sample")}
            >
              샘플 패키지
            </button>
            <button
              type="button"
              className="chip"
              data-active={mode === "upload"}
              onClick={() => setMode("upload")}
            >
              실제 자료 업로드
            </button>
          </div>

          {mode === "sample" ? (
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
          ) : (
            <form className="upload-intake-form" onSubmit={submitUpload}>
              <label>
                <span>심의 제목</span>
                <input
                  aria-label="심의 제목"
                  value={uploadTitle}
                  onChange={(event) => setUploadTitle(event.target.value)}
                />
              </label>
              <label>
                <span>상품군</span>
                <select
                  aria-label="상품군"
                  value={uploadProductType}
                  onChange={(event) => setUploadProductType(event.target.value as ProductType)}
                >
                  <option value="deposit">예금/적금</option>
                  <option value="loan">대출</option>
                </select>
              </label>
              <label>
                <span>자료 파일</span>
                <input
                  aria-label="자료 파일"
                  type="file"
                  multiple
                  accept={uploadAcceptAttribute}
                  onChange={(event) => setUploadFiles(Array.from(event.target.files ?? []))}
                />
              </label>
              <p className="upload-policy-note">{formatUploadPolicySummary()}</p>
              <button className="button button--primary upload-submit" type="submit">
                <Upload size={16} aria-hidden="true" />
                {isUploading ? "업로드 중" : "업로드 생성"}
              </button>
              {uploadError ? <p className="form-error">{uploadError}</p> : null}
            </form>
          )}
        </div>

        {mode === "sample" && preview ? (
          <div className="intake-preview">
            <PreviewSummary
              title={preview.title}
              productType={preview.productType}
              affiliate={preview.affiliate}
              issueCount={preview.issueCount}
            />
            <ClassificationPanel files={preview.files} />
            <RequiredMaterialsPanel
              rows={sampleMaterialRows}
              extraMissingMaterials={sampleExtraMissingMaterials}
            >
              <Link
                className="button button--primary intake-start"
                href={preview.analysisStartHref}
              >
                AI 분석 시작
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </RequiredMaterialsPanel>
          </div>
        ) : null}

        {mode === "upload" ? (
          <div className="intake-preview">
            {uploadResult ? (
              <>
                <PreviewSummary
                  title={uploadResult.reviewCase.title}
                  productType={uploadResult.reviewCase.productType}
                  affiliate="광주은행"
                  issueCount={0}
                />
                <ClassificationPanel files={uploadResult.files} />
                <RequiredMaterialsPanel
                  rows={uploadMaterialRows}
                  extraMissingMaterials={uploadExtraMissingMaterials}
                >
                  <button
                    className="button button--primary intake-start"
                    type="button"
                    onClick={startUploadedAnalysis}
                  >
                    <ArrowRight size={16} aria-hidden="true" />
                    {isStartingAnalysis ? "분석 시작 중" : "실제 자료 분석 시작"}
                  </button>
                </RequiredMaterialsPanel>
                {uploadAnalysis ? (
                  <section className="panel panel--compact upload-analysis-result">
                    <p>{uploadAnalysis.analysisNotice}</p>
                    <Link className="button" href={uploadAnalysis.analysisHref}>
                      생성된 심의 건 열기
                    </Link>
                  </section>
                ) : null}
              </>
            ) : (
              <section className="panel panel--compact upload-empty-state">
                <FileCheck2 size={22} aria-hidden="true" />
                <p>실제 파일을 업로드하면 분류 결과와 누락 자료가 여기에 표시됩니다.</p>
              </section>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function PreviewSummary({
  title,
  productType,
  affiliate,
  issueCount
}: {
  title: string;
  productType: ProductType;
  affiliate: string;
  issueCount: number;
}) {
  return (
    <section className="panel panel--compact">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Request Summary</p>
          <h3>{title}</h3>
        </div>
        <span className="status-badge">{productLabels[productType]}</span>
      </div>
      <dl className="summary-list">
        <div>
          <dt>계열사</dt>
          <dd>{affiliate}</dd>
        </div>
        <div>
          <dt>AI 위험 후보</dt>
          <dd>{issueCount}개</dd>
        </div>
      </dl>
    </section>
  );
}

function ClassificationPanel({ files }: { files: ReviewFile[] }) {
  return (
    <section className="panel panel--compact">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Classification</p>
          <h3>파일 자동 분류 결과</h3>
        </div>
        <FileCheck2 size={20} aria-hidden="true" />
      </div>

      <div className="classification-list">
        {files.map((file) => (
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
  );
}

function RequiredMaterialsPanel({
  rows,
  extraMissingMaterials,
  children
}: {
  rows: RequiredMaterialRow[];
  extraMissingMaterials: string[];
  children: ReactNode;
}) {
  return (
    <section className="panel panel--compact">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Required Materials</p>
          <h3>필수 자료 확인</h3>
        </div>
        <TriangleAlert size={20} aria-hidden="true" />
      </div>

      <div className="materials-grid">
        {rows.map((row) => (
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

      {children}
    </section>
  );
}
