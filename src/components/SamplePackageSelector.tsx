"use client";

import { type FormEvent, useEffect, useState, type JSX } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import JSZip from "jszip";
import { getRequiredMaterialRows, type RequiredMaterialRow } from "@/domain/intake";
import { classifyUploadFileWithConfidence } from "@/domain/upload-policy";
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
const submissionNoticeDurationMs = 3500;

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

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  txt: "text/plain",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  html: "text/html"
};

function mimeForName(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

async function buildFilePreview(files: File[]): Promise<ReviewFile[]> {
  const result: ReviewFile[] = [];
  let idSeq = 0;

  for (const file of files) {
    const ext = file.name.toLowerCase().split(".").pop();

    if (ext === "zip") {
      try {
        const zip = await JSZip.loadAsync(await file.arrayBuffer());
        for (const [entryPath, entry] of Object.entries(zip.files)) {
          if (entry.dir || entryPath.startsWith("__MACOSX/")) continue;
          const baseName = entryPath.split("/").filter(Boolean).pop() ?? entryPath;
          const mime = mimeForName(baseName);
          const cls = classifyUploadFileWithConfidence({ name: baseName, type: mime, size: 0 });
          idSeq += 1;
          result.push({
            id: `local-file-${idSeq}`,
            name: `${file.name}/${entryPath}`,
            fileType: cls.fileType,
            classificationConfidence: cls.confidence,
            parseStatus: "pending",
            contentType: mime,
            sizeBytes: 0
          });
        }
      } catch {
        idSeq += 1;
        result.push({
          id: `local-file-${idSeq}`,
          name: file.name,
          fileType: "package_archive",
          classificationConfidence: 0.99,
          parseStatus: "pending",
          contentType: "application/zip",
          sizeBytes: file.size
        });
      }
    } else {
      const mime = file.type || mimeForName(file.name);
      const cls = classifyUploadFileWithConfidence({ name: file.name, type: mime, size: file.size });
      idSeq += 1;
      result.push({
        id: `local-file-${idSeq}`,
        name: file.name,
        fileType: cls.fileType,
        classificationConfidence: cls.confidence,
        parseStatus: "pending",
        contentType: mime,
        sizeBytes: file.size
      });
    }
  }

  return result;
}

export function SamplePackageSelector(): JSX.Element {
  const router = useRouter();
  const roleContext = useRoleContext();
  const [meta, setMeta] = useState<IntakeMetaState>(initialMeta);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [previewFiles, setPreviewFiles] = useState<ReviewFile[]>([]);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [showSubmissionNotice, setShowSubmissionNotice] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    if (!showSubmissionNotice) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setShowSubmissionNotice(false);
    }, submissionNoticeDurationMs);

    return () => window.clearTimeout(timeoutId);
  }, [showSubmissionNotice]);

  useEffect(() => {
    let cancelled = false;
    const files = uploadFiles;

    const promise =
      files.length === 0 ? Promise.resolve<ReviewFile[]>([]) : buildFilePreview(files);

    void promise.then((rows) => {
      if (!cancelled) {
        setPreviewFiles(rows);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [uploadFiles]);

  const classifiedFiles = uploadResult?.files ?? previewFiles;
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
    setShowSubmissionNotice(false);

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

    if (missingMaterialRows.length > 0) {
      setUploadError(
        `필수 심의 자료가 누락되었습니다: ${missingMaterialRows
          .map((row) => row.label)
          .join(", ")}. 누락 자료를 보완한 뒤 제출해 주세요.`
      );
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
      setShowSubmissionNotice(true);
      router.push("/reviews/history");
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "업로드 요청을 처리하지 못했습니다.");
    } finally {
      setIsUploading(false);
    }
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

      {uploadResult && showSubmissionNotice ? (
        <section
          className="submission-notice"
          role="status"
          aria-label="심의 요청 등록 완료"
        >
          <p>심의 요청이 등록되었습니다.</p>
        </section>
      ) : null}

      <form className="intake-reference-layout" onSubmit={submitUpload}>
        <section className="intake-main-column">
          <IntakeMetaForm state={meta} onChange={setMeta} />

          <IntakeUploadZone
            files={uploadFiles}
            onFilesChange={(next) => {
              setUploadFiles(next);
              setUploadResult(null);
              setShowSubmissionNotice(false);
            }}
            error={uploadError}
            onError={setUploadError}
          />
        </section>

        <aside className="intake-side-column">
          <IntakeClassificationPanel
            files={classifiedFiles}
            isLoading={!uploadResult && uploadFiles.length > 0 && previewFiles.length === 0}
          />
          <IntakeRequiredMaterialsPanel
            rows={missingMaterialRows}
            extraMissingMaterials={extraMissingMaterials}
          >
            <p className="intake-gate-note">
              {missingMaterialRows.length > 0
                ? "필수 심의 자료가 모두 갖춰져야 심의 요청을 제출할 수 있습니다."
                : "Reviewer가 분석 시작 전 보완 요청 또는 제한적 분석 여부를 판단합니다."}
            </p>
          </IntakeRequiredMaterialsPanel>
        </aside>

        {!uploadResult ? (
          <div className="intake-footer-bar">
            <button
              className="button button--primary upload-submit"
              type="submit"
              disabled={isUploading || missingMaterialRows.length > 0}
            >
              {isUploading ? (
                <>
                  <LoaderCircle className="action-spinner" size={17} aria-hidden="true" />
                  제출 중
                </>
              ) : (
                "심의 요청 제출"
              )}
            </button>
          </div>
        ) : null}
      </form>
    </div>
  );
}
