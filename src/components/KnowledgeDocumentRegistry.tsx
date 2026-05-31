"use client";

import { useEffect, useMemo, useState, type FormEvent, type JSX } from "react";
import {
  BookOpenCheck,
  CheckCircle2,
  Database,
  FileText,
  LoaderCircle,
  RotateCcw,
  Send,
  ShieldCheck,
  Trash2
} from "lucide-react";
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

type KnowledgeDocumentDeleteResponse = {
  deleted: boolean;
  documentId: string;
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

function documentTypeLabel(value: KnowledgeDocumentType): string {
  return documentTypes.find((item) => item.value === value)?.label ?? value;
}

function productTypeLabel(value?: ProductType): string {
  if (!value) {
    return "전체 상품";
  }

  return productTypes.find((item) => item.value === value)?.label ?? value;
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
  const [pendingDocumentAction, setPendingDocumentAction] = useState<{
    documentId: string;
    action: "approve" | "unapprove" | "delete";
  } | null>(null);

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
    setPendingDocumentAction({ documentId, action: "approve" });

    try {
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
    } finally {
      setPendingDocumentAction(null);
    }
  }

  async function unapproveDocument(documentId: string): Promise<void> {
    setPendingDocumentAction({ documentId, action: "unapprove" });

    try {
      const response = await fetch(`/api/v1/knowledge-documents/${documentId}/approve`, {
        method: "DELETE",
        headers: roleContext?.apiHeaders()
      });

      if (!response.ok) {
        setStatus("지식문서 승인해제에 실패했습니다.");
        return;
      }

      const body = (await response.json()) as { document: KnowledgeDocument };
      setDocuments((current) =>
        current.map((document) => (document.id === documentId ? body.document : document))
      );
      setStatus("승인해제 완료");
    } finally {
      setPendingDocumentAction(null);
    }
  }

  async function deleteDocument(document: KnowledgeDocument): Promise<void> {
    if (!window.confirm(`${document.title} 지식문서를 삭제할까요?`)) {
      return;
    }

    setPendingDocumentAction({ documentId: document.id, action: "delete" });

    try {
      const response = await fetch(`/api/v1/knowledge-documents/${document.id}`, {
        method: "DELETE",
        headers: roleContext?.apiHeaders()
      });

      if (!response.ok) {
        setStatus("지식문서 삭제에 실패했습니다.");
        return;
      }

      const body = (await response.json()) as KnowledgeDocumentDeleteResponse;
      setDocuments((current) => current.filter((item) => item.id !== body.documentId));
      setStatus("삭제 완료");
    } finally {
      setPendingDocumentAction(null);
    }
  }

  return (
    <main className="knowledge-page">
      <section className="knowledge-page__header">
        <div className="knowledge-page__heading">
          <span className="section-eyebrow">
            <BookOpenCheck size={16} aria-hidden="true" />
            Knowledge Registry
          </span>
          <h1>컴플라이언스 지식문서 관리</h1>
          <p>
            법령, 내부 정책, 체크리스트를 한곳에 정리해 금융 광고 심의의 기준 근거로
            사용할 수 있습니다.
          </p>
          <p className="knowledge-page__slogan">Review Faster. Decide Smarter.</p>
        </div>
        <div className="knowledge-page__metrics" aria-label="지식문서 등록 현황">
          <div>
            <Database size={18} aria-hidden="true" />
            <strong>{registeredCount}</strong>
            <span>등록 문서</span>
          </div>
        </div>
      </section>

      <section className="knowledge-console-grid" aria-label="지식문서 운영 카테고리">
        <article>
          <span>Policy</span>
          <strong>내부 정책</strong>
          <small>상품 광고 심의 기준과 내부 체크 기준을 관리합니다.</small>
        </article>
        <article>
          <span>Law</span>
          <strong>법령 근거</strong>
          <small>규정 변경과 시행일을 기준으로 검색 가능한 근거를 축적합니다.</small>
        </article>
        <article>
          <span>Checklist</span>
          <strong>검토 체크리스트</strong>
          <small>심의자가 반복 확인하는 항목을 구조화된 지식으로 유지합니다.</small>
        </article>
      </section>

      <section className="knowledge-layout">
        <form className="knowledge-form" onSubmit={handleSubmit}>
          <div className="knowledge-panel__header">
            <div>
              <span>Document Upload</span>
              <h2>새 기준 문서 등록</h2>
              <p>문서 유형과 적용 상품군을 함께 지정해 심의 기준 라이브러리에 추가합니다.</p>
            </div>
            <ShieldCheck size={22} aria-hidden="true" />
          </div>

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
            {isSubmitting ? (
              <>
                <LoaderCircle className="action-spinner" size={17} aria-hidden="true" />
                등록중
              </>
            ) : (
              <>
                <Send size={17} aria-hidden="true" />
                지식문서 등록
              </>
            )}
          </button>
          {status ? <p className="form-status">{status}</p> : null}
        </form>

        <div className="knowledge-list" aria-label="등록된 지식문서">
          <div className="knowledge-panel__header knowledge-panel__header--list">
            <div>
              <span>Registered Sources</span>
              <h2>등록된 지식문서</h2>
              <p>승인된 기준 문서는 심의 근거 검색에 우선 활용됩니다.</p>
            </div>
            <strong>{registeredCount}건</strong>
          </div>

          {documents.length === 0 ? (
            <div className="knowledge-empty">
              <ShieldCheck size={22} aria-hidden="true" />
              <span>아직 등록된 지식문서가 없습니다.</span>
            </div>
          ) : (
            documents.map((document) => {
              const pendingAction =
                pendingDocumentAction?.documentId === document.id
                  ? pendingDocumentAction.action
                  : null;

              return (
                <article className="knowledge-list__item" key={document.id}>
                  <div className="knowledge-list__content">
                    <div className="knowledge-list__title-row">
                      <FileText size={18} aria-hidden="true" />
                      <h3>{document.title}</h3>
                    </div>
                    <dl className="knowledge-list__meta">
                      <div>
                        <dt>유형</dt>
                        <dd>{documentTypeLabel(document.documentType)}</dd>
                      </div>
                      <div>
                        <dt>상품군</dt>
                        <dd>{productTypeLabel(document.productType)}</dd>
                      </div>
                      <div>
                        <dt>버전</dt>
                        <dd>{document.version}</dd>
                      </div>
                      <div>
                        <dt>시행일</dt>
                        <dd>{document.effectiveFrom}</dd>
                      </div>
                    </dl>
                  </div>
                  <div className="knowledge-list__actions">
                    {document.approvalStatus !== "draft" ? (
                      <span className="status-pill" data-status={document.approvalStatus}>
                        {statusLabel(document.approvalStatus)}
                      </span>
                    ) : null}
                    {document.approvalStatus === "draft" ? (
                      <button
                        className="secondary-action"
                        type="button"
                        disabled={pendingAction === "approve"}
                        onClick={() => void approveDocument(document.id)}
                      >
                        {pendingAction === "approve" ? (
                          <>
                            <LoaderCircle
                              className="action-spinner"
                              size={16}
                              aria-hidden="true"
                            />
                            승인중
                          </>
                        ) : (
                          <>
                            <CheckCircle2 size={16} aria-hidden="true" />
                            승인
                          </>
                        )}
                      </button>
                    ) : document.approvalStatus === "approved" ? (
                      <button
                        className="secondary-action"
                        type="button"
                        disabled={pendingAction === "unapprove"}
                        onClick={() => void unapproveDocument(document.id)}
                      >
                        {pendingAction === "unapprove" ? (
                          <>
                            <LoaderCircle
                              className="action-spinner"
                              size={16}
                              aria-hidden="true"
                            />
                            승인해제중
                          </>
                        ) : (
                          <>
                            <RotateCcw size={16} aria-hidden="true" />
                            승인해제
                          </>
                        )}
                      </button>
                    ) : null}
                    <button
                      className="secondary-action secondary-action--danger"
                      type="button"
                      disabled={!!pendingAction}
                      onClick={() => void deleteDocument(document)}
                      aria-label="삭제"
                      title="삭제"
                    >
                      {pendingAction === "delete" ? (
                        <LoaderCircle className="action-spinner" size={16} aria-hidden="true" />
                      ) : (
                        <Trash2 size={16} aria-hidden="true" />
                      )}
                      삭제
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>
    </main>
  );
}
