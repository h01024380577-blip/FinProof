import JSZip from "jszip";
import type { EvidenceChunk } from "@/domain/types";
import {
  createEmbeddingProvider,
  type EmbeddingProvider
} from "@/server/knowledge/embedding-provider";

export type KnowledgeDocumentTextInput = {
  fileName: string;
  contentType: string;
  body: Uint8Array;
};

export type CreateKnowledgeDocumentChunksInput = {
  tenantId: string;
  documentId: string;
  text: string;
  embeddingProvider?: EmbeddingProvider;
  now?: () => Date;
};

const chunkSize = 1400;
const chunkOverlap = 160;

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stripHtml(text: string): string {
  return normalizeText(
    text
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
  );
}

function isTextLike(fileName: string, contentType: string): boolean {
  const normalizedType = contentType.toLowerCase();

  return (
    normalizedType.startsWith("text/") ||
    normalizedType.includes("json") ||
    normalizedType.includes("csv") ||
    normalizedType.includes("xml") ||
    normalizedType.includes("html") ||
    /\.(txt|md|csv|json|xml|html?)$/i.test(fileName)
  );
}

function xmlText(text: string): string {
  return normalizeText(
    text
      .replace(/<w:tab\/>/g, " ")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
  );
}

async function extractDocxText(body: Uint8Array): Promise<string | undefined> {
  const zip = await JSZip.loadAsync(body);
  const documentXml = await zip.file("word/document.xml")?.async("text");

  return documentXml ? xmlText(documentXml) : undefined;
}

export async function extractKnowledgeDocumentText({
  fileName,
  contentType,
  body
}: KnowledgeDocumentTextInput): Promise<string> {
  const normalizedType = contentType.toLowerCase();

  if (
    normalizedType.includes("wordprocessingml.document") ||
    fileName.toLowerCase().endsWith(".docx")
  ) {
    const docxText = await extractDocxText(body);

    if (docxText) {
      return docxText;
    }
  }

  if (isTextLike(fileName, contentType)) {
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(body);

    return normalizedType.includes("html") || /\.html?$/i.test(fileName)
      ? stripHtml(decoded)
      : normalizeText(decoded);
  }

  return normalizeText(
    [
      `파일명: ${fileName}`,
      "이 첨부파일은 현재 로컬 텍스트 추출 대상이 아니어서 메타데이터 기반으로 색인되었습니다.",
      "운영 환경에서는 OCR 또는 문서 파서 연동 후 원문 청크를 재색인해야 합니다."
    ].join(" ")
  );
}

function splitChunks(text: string): string[] {
  const normalized = normalizeText(text);

  if (!normalized) {
    return [];
  }

  if (normalized.length <= chunkSize) {
    return [normalized];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    const end = Math.min(normalized.length, start + chunkSize);
    chunks.push(normalized.slice(start, end).trim());

    if (end === normalized.length) {
      break;
    }

    start = Math.max(end - chunkOverlap, start + 1);
  }

  return chunks.filter((chunk) => chunk.length > 0);
}

function chunkSummary(text: string): string {
  const normalized = normalizeText(text);

  return normalized.length > 180 ? `${normalized.slice(0, 180)}...` : normalized;
}

export async function createKnowledgeDocumentChunks({
  tenantId,
  documentId,
  text,
  embeddingProvider = createEmbeddingProvider(),
  now = () => new Date()
}: CreateKnowledgeDocumentChunksInput): Promise<EvidenceChunk[]> {
  const texts = splitChunks(text);
  const embeddings = texts.length > 0 ? await embeddingProvider.embed(texts) : [];
  const createdAt = now().toISOString();

  return texts.map((chunkText, index) => {
    const sequence = String(index + 1).padStart(3, "0");

    return {
      id: `chunk-${documentId}-${sequence}`,
      tenantId,
      knowledgeDocumentId: documentId,
      chunkText,
      chunkSummary: chunkSummary(chunkText),
      embeddingModel: embeddingProvider.model,
      embeddingId: `embedding-${documentId}-${sequence}`,
      metadata: {
        source: "knowledge_document",
        chunkIndex: index,
        embeddingVector: embeddings[index] ?? []
      },
      createdAt
    };
  });
}
