"use client";

import { type FormEvent, useMemo, useState, type JSX } from "react";
import Link from "next/link";
import { getRequiredMaterialRows, type RequiredMaterialRow } from "@/domain/intake";
import type { ProductType, ReviewFile } from "@/domain/types";
import { IntakeClassificationPanel } from "./intake/IntakeClassificationPanel";
import { IntakeMetaForm, type IntakeMetaState } from "./intake/IntakeMetaForm";
import { IntakeRequiredMaterialsPanel } from "./intake/IntakeRequiredMaterialsPanel";
import { IntakeStepper } from "./intake/IntakeStepper";
import { IntakeUploadZone } from "./intake/IntakeUploadZone";
import { useRoleContext } from "./RoleContext";

type UploadResult = {
  reviewCase: {
    id: string;
    title: string;
    productType: ProductType;
    status?: string;
  };
  files: ReviewFile[];
  missingMaterials: string[];
  analysisStartHref: string;
};

const initialMeta: IntakeMetaState = {
  title: "",
  affiliate: "",
  requestDepartment: "",
  productType: "",
  plannedPublishDate: "",
  channels: { mobile_app: false, website: false, offline: false },
  requestMemo: ""
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

function inferFileType(fileName: string): ReviewFile["fileType"] {
  const normalizedName = fileName.toLocaleLowerCase("ko-KR");

  if (normalizedName.includes("terms") || normalizedName.includes("약관")) {
    return "terms";
  }

  if (
    normalizedName.includes("rate") ||
    normalizedName.includes("금리") ||
    normalizedName.endsWith(".xlsx") ||
    normalizedName.endsWith(".csv")
  ) {
    return "rate_table";
  }

  if (normalizedName.includes("checklist") || normalizedName.includes("체크")) {
    return "checklist";
  }

  if (
    normalizedName.includes("description") ||
    normalizedName.includes("설명") ||
    normalizedName.includes("t&c")
  ) {
    return "product_description";
  }

  if (normalizedName.includes("copy") || normalizedName.includes("카피")) {
    return "copy_draft";
  }

  return "promotional_creative";
}

function buildLocalFilePreview(files: File[]): ReviewFile[] {
  return files.map((file, index) => ({
    id: `local-file-${index + 1}`,
    name: file.name,
    fileType: inferFileType(file.name),
    classificationConfidence: 0.82,
    parseStatus: "pending",
    contentType: file.type,
    sizeBytes: file.size
  }));
}

export function SamplePackageSelector(): JSX.Element {
  const roleContext = useRoleContext();
  const [meta, setMeta] = useState<IntakeMetaState>(initialMeta);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const localFilePreview = useMemo(() => buildLocalFilePreview(uploadFiles), [uploadFiles]);
  const classifiedFiles = uploadResult?.files ?? localFilePreview;
  const activeProductType = uploadResult?.reviewCase.productType ?? meta.productType;
  const materialRows = activeProductType
    ? getRequiredMaterialRows({
        productType: activeProductType,
        files: classifiedFiles
      })
    : [];
  const extraMissingMaterials = uploadResult
    ? getExtraMissingMaterials(uploadResult.missingMaterials, materialRows)
    : [];
  const missingMaterialRows = materialRows.filter((row) => row.status === "missing");

  async function submitUpload(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setUploadResult(null);

    if (uploadFiles.length === 0) {
      if (!uploadError) {
        setUploadError("업로드할 파일을 선택해 주세요.");
      }
      return;
    }

    if (
      meta.title.trim().length === 0 ||
      meta.affiliate.trim().length === 0 ||
      meta.requestDepartment.trim().length === 0 ||
      meta.productType.length === 0 ||
      meta.plannedPublishDate.trim().length === 0
    ) {
      setUploadError("필수 메타 정보를 입력해 주세요.");
      return;
    }

    setUploadError(null);

    const formData = new FormData();
    formData.set("title", meta.title);
    formData.set("affiliate", meta.affiliate);
    formData.set("productType", meta.productType);
    Object.entries(meta.channels)
      .filter(([, isSelected]) => isSelected)
      .forEach(([channel]) => formData.append("channelType", channel));
    formData.set("plannedPublishDate", meta.plannedPublishDate);
    formData.set("requestDepartment", meta.requestDepartment);
    formData.set("memo", meta.requestMemo);
    uploadFiles.forEach((file) => formData.append("files", file));

    setIsUploading(true);
    try {
      const response = await fetch("/api/v1/review-cases", {
        method: "POST",
        headers: roleContext?.apiHeaders(),
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

  function resetForNextRequest(): void {
    setMeta(initialMeta);
    setUploadFiles([]);
    setUploadResult(null);
    setUploadError(null);
  }

  return (
    <div className="intake-flow">
      <div className="intake-title-row">
        <div>
          <h2>신규 심의 요청</h2>
        </div>
        <IntakeStepper
          hasTitle={meta.title.trim().length > 0}
          hasFiles={uploadFiles.length > 0}
          hasUploadResult={Boolean(uploadResult)}
        />
      </div>

      <form className="intake-reference-layout" onSubmit={submitUpload}>
        <section className="intake-main-column">
          <IntakeMetaForm state={meta} onChange={setMeta} />

          <IntakeUploadZone
            files={uploadFiles}
            onFilesChange={(next) => {
              setUploadFiles(next);
              setUploadResult(null);
            }}
            error={uploadError}
            onError={setUploadError}
          />
        </section>

        <aside className="intake-side-column">
          <IntakeClassificationPanel files={classifiedFiles} />
          <IntakeRequiredMaterialsPanel
            rows={missingMaterialRows}
            extraMissingMaterials={extraMissingMaterials}
          >
            <p className="intake-gate-note">
              Reviewer가 분석 시작 전 보완 요청 또는 제한적 분석 여부를 판단합니다.
            </p>
          </IntakeRequiredMaterialsPanel>
        </aside>

        <div className="intake-footer-bar">
          {uploadResult ? (
            <section className="submission-notice" aria-label="Submission status">
              <p>심의 대기 목록에 분석 대기 건으로 등록되었습니다.</p>
              <Link className="button" href="/reviews">
                심의 대기 목록에서 확인
              </Link>
              <button className="button" type="button" onClick={resetForNextRequest}>
                다른 요청 작성
              </button>
            </section>
          ) : (
            <button
              className="button button--primary upload-submit"
              type="submit"
              disabled={isUploading}
            >
              {isUploading ? "제출 중" : "심의 요청 제출"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
