"use client";

import { useEffect, useMemo, useState, type FormEvent, type JSX } from "react";
import { BookOpenCheck, CheckCircle2, Database, Send, ShieldCheck } from "lucide-react";
import type { KnowledgeDocument, KnowledgeDocumentType, ProductType } from "@/domain/types";
import { DropZone } from "@/components/ui";
import { useRoleContext } from "./RoleContext";

type KnowledgeDocumentResponse = {
  documents?: KnowledgeDocument[];
};

type KnowledgeDocumentCreateResponse = {
  document: KnowledgeDocument;
  ingestion: {
    chunkCount: number;
    embeddingModel: string;
  };
};

const documentTypes: Array<{ value: KnowledgeDocumentType; label: string }> = [
  { value: "internal_policy", label: "내부 정책" },
  { value: "law", label: "법령" },
  { value: "checklist", label: "체크리스트" },
  { value: "guide", label: "가이드" }
];

const productTypes: Array<{ value: ProductType; label: string }> = [
  { value: "deposit", label: "예금" },
  { value: "loan", label: "대출" },
  { value: "card", label: "카드" },
  { value: "capital", label: "캐피탈" },
  { value: "insurance", label: "보험" },
  { value: "investment", label: "투자" }
];

function statusLabel(status: KnowledgeDocument["approvalStatus"]): string {
  if (status === "approved") {
    return "승인";
  }

  if (status === "inactive") {
    return "비활성";
  }

  return "초안";
}

export function KnowledgeDocumentRegistry(): JSX.Element {
  const roleContext = useRoleContext();
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [version, setVersion] = useState("");
  const [documentType, setDocumentType] = useState<KnowledgeDocumentType>("internal_policy");
  const [productType, setProductType] = useState<ProductType | "">("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const registeredCount = useMemo(() => documents.length, [documents]);

  useEffect(() => {
    let mounted = true;

    async function loadDocuments() {
      const response = await fetch("/api/v1/knowledge-documents");
      const body = (await response.json()) as KnowledgeDocumentResponse;

      if (mounted) {
        setDocuments(body.documents ?? []);
      }
    }

    void loadDocuments().catch(() => {
      if (mounted) {
        setStatus("지식문서 목록을 불러오지 못했습니다.");
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  function handleFilesSelected(selected: File[]): void {
    const [file] = selected;

    if (!file) {
      return;
    }

    setUploadError(null);
    setFiles([file]);
  }

  function handleRemoveFile(): void {
    setFiles([]);
    setUploadError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const [file] = files;

    if (!file) {
      setUploadError("지식문서 첨부파일을 선택해 주세요.");
      return;
    }

    const formData = new FormData();
    formData.set("title", title);
    formData.set("version", version);
    formData.set("documentType", documentType);
    if (productType) {
      formData.set("productType", productType);
    }
    formData.set("effectiveFrom", effectiveFrom);
    formData.set("file", file);

    setIsSubmitting(true);
    setStatus(null);

    try {
      const response = await fetch("/api/v1/knowledge-documents", {
        method: "POST",
        headers: roleContext?.apiHeaders(),
        body: formData
      });

      if (!response.ok) {
        throw new Error("지식문서 등록에 실패했습니다.");
      }

      const body = (await response.json()) as KnowledgeDocumentCreateResponse;
      setDocuments((current) => [body.document, ...current]);
      setStatus(`등록 완료 · ${body.ingestion.chunkCount}개 청크 임베딩 저장`);
      setTitle("");
      setVersion("");
      setProductType("");
      setEffectiveFrom("");
      setFiles([]);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "지식문서 등록에 실패했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function approveDocument(documentId: string): Promise<void> {
    const response = await fetch(`/api/v1/knowledge-documents/${documentId}/approve`, {
      method: "POST",
      headers: roleContext?.apiHeaders()
    });

    if (!response.ok) {
      setStatus("지식문서 승인에 실패했습니다.");
      return;
    }

    const body = (await response.json()) as { document: KnowledgeDocument };
    setDocuments((current) =>
      current.map((document) => (document.id === documentId ? body.document : document))
    );
    setStatus("승인 완료");
  }

  return (
    <main className="knowledge-page">
      <section className="knowledge-page__header">
        <div>
          <span className="section-eyebrow">
            <BookOpenCheck size={16} aria-hidden="true" />
            Knowledge Registry
          </span>
          <h1>지식문서 등록</h1>
        </div>
        <div className="knowledge-page__metrics" aria-label="지식문서 등록 현황">
          <div>
            <Database size={18} aria-hidden="true" />
            <strong>{registeredCount}</strong>
            <span>등록 문서</span>
          </div>
        </div>
      </section>

      <section className="knowledge-layout">
        <form className="knowledge-form" onSubmit={handleSubmit}>
          <div className="form-grid form-grid--two">
            <label>
              <span>문서 제목</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} required />
            </label>
            <label>
              <span>버전</span>
              <input
                value={version}
                onChange={(event) => setVersion(event.target.value)}
                required
              />
            </label>
            <label>
              <span>문서 유형</span>
              <select
                value={documentType}
                onChange={(event) => setDocumentType(event.target.value as KnowledgeDocumentType)}
              >
                {documentTypes.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>상품군</span>
              <select
                value={productType}
                onChange={(event) => setProductType(event.target.value as ProductType | "")}
              >
                <option value="">전체</option>
                {productTypes.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>시행일</span>
              <input
                type="date"
                value={effectiveFrom}
                onChange={(event) => setEffectiveFrom(event.target.value)}
                required
              />
            </label>
          </div>

          <DropZone
            accept=".txt,.md,.csv,.json,.html,.docx,.pdf"
            multiple={false}
            files={files}
            helperText="지식문서 첨부파일"
            error={uploadError}
            onFilesSelected={handleFilesSelected}
            onRemoveFile={handleRemoveFile}
          />

          <button className="primary-action" type="submit" disabled={isSubmitting}>
            <Send size={17} aria-hidden="true" />
            지식문서 등록
          </button>
          {status ? <p className="form-status">{status}</p> : null}
        </form>

        <div className="knowledge-list" aria-label="등록된 지식문서">
          {documents.length === 0 ? (
            <div className="knowledge-empty">
              <ShieldCheck size={22} aria-hidden="true" />
              <span>등록된 지식문서가 없습니다.</span>
            </div>
          ) : (
            documents.map((document) => (
              <article className="knowledge-list__item" key={document.id}>
                <div>
                  <h2>{document.title}</h2>
                  <p>
                    {document.version} · {document.effectiveFrom}
                  </p>
                </div>
                <span className="status-pill" data-status={document.approvalStatus}>
                  {statusLabel(document.approvalStatus)}
                </span>
                {document.approvalStatus === "draft" ? (
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => void approveDocument(document.id)}
                  >
                    <CheckCircle2 size={16} aria-hidden="true" />
                    승인
                  </button>
                ) : null}
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
