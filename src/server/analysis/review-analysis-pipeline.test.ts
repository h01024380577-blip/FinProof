import type { ReviewCase } from "@/domain/types";
import { createGeminiOcrProvider, createReviewAnalysisPipeline } from "./review-analysis-pipeline";
import type { ModelProvider } from "@/server/ai/model-provider";
import type { ReviewStoreScope } from "@/server/reviews";
import type { ReviewSubAgentOrchestrator } from "./review-subagents";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const review: ReviewCase = {
  id: "rc-upload-001",
  title: "실제 업로드 적금 홍보물",
  affiliate: "광주은행",
  productType: "deposit",
  channelType: ["poster"],
  plannedPublishDate: "2026-06-20",
  status: "analysis_waiting",
  highestRiskLevel: "info",
  requester: "업로드 요청자",
  reviewer: "준법심의자",
  promotionalCopy: "최고 연 5.0% 우대금리",
  disclosure: "조건 충족 시 적용",
  productDescription: "우대금리는 급여이체 조건 충족 시 제공됩니다.",
  missingMaterials: [],
  files: [
    {
      id: "file-upload-001",
      name: "poster.png",
      fileType: "promotional_creative",
      classificationConfidence: 0.78,
      parseStatus: "pending",
      storageProvider: "s3",
      storageKey: "s3://finproof-s3/reviews/rc-upload-001/file-upload-001/poster.png",
      contentType: "image/png",
      sizeBytes: 1024
    }
  ],
  issues: [],
  expectedDraft: "검토 필요"
};

describe("review analysis pipeline", () => {
  it("extracts OCR text and creates RAG evidence candidates", async () => {
    const pipeline = createReviewAnalysisPipeline({
      ocrProvider: {
        async extract(input) {
          return input.files.map((file) => ({
            fileId: file.id,
            fileName: file.name,
            storageKey: file.storageKey,
            text: "최고 연 5.0% 우대금리는 급여이체 조건 충족 시 제공됩니다.",
            confidence: 0.91,
            provider: "fixture-ocr"
          }));
        }
      }
    });

    const artifacts = await pipeline.run({ review });

    expect(artifacts.extractedDocuments).toEqual([
      expect.objectContaining({
        fileId: "file-upload-001",
        text: expect.stringContaining("급여이체 조건"),
        confidence: 0.91,
        provider: "fixture-ocr"
      })
    ]);
    expect(artifacts.evidenceCandidates).toEqual([
      expect.objectContaining({
        id: "evidence-candidate-file-upload-001-001",
        sourceType: "product_doc",
        title: "poster.png",
        quoteSummary: expect.stringContaining("급여이체 조건"),
        relevanceScore: expect.any(Number)
      })
    ]);
  });

  it("extracts text from stored upload bodies before retrieval", async () => {
    const pipeline = createReviewAnalysisPipeline({
      fileBodyReader: {
        async getReviewFileBody(storageKey) {
          expect(storageKey).toBe("local/rc-upload-001/file-upload-001/poster.html");

          return new TextEncoder().encode(
            "<main><h1>누구나 최고 연 5.0%</h1><p>급여이체 등 우대 조건 충족 시 적용됩니다.</p></main>"
          );
        }
      }
    });

    const artifacts = await pipeline.run({
      review: {
        ...review,
        files: [
          {
            ...review.files[0],
            name: "poster.html",
            storageProvider: "local",
            storageKey: "local/rc-upload-001/file-upload-001/poster.html",
            contentType: "text/html"
          }
        ]
      }
    });

    expect(artifacts.extractedDocuments).toEqual([
      expect.objectContaining({
        fileName: "poster.html",
        provider: "local-text-extractor",
        text: expect.stringContaining("누구나 최고 연 5.0%"),
        confidence: 0.96
      })
    ]);
    expect(artifacts.evidenceCandidates[0]).toEqual(
      expect.objectContaining({
        quoteSummary: expect.stringContaining("우대 조건 충족")
      })
    );
  });

  it("extracts searchable text from stored PDF bodies before retrieval", async () => {
    const binDir = await mkdtemp(path.join(tmpdir(), "finproof-pdftotext-"));
    const originalPath = process.env.PATH;
    const originalPdfToTextPath = process.env.FINPROOF_PDFTOTEXT_PATH;
    const fakePdfToText = path.join(binDir, "pdftotext");

    await writeFile(
      fakePdfToText,
      [
        "#!/bin/sh",
        "printf '%s\\n' '누구나 최고 연 5.0% 우대 조건 충족 시 적용됩니다. 급여이체와 자동이체 조건을 모두 충족해야 하며 세전 기준입니다.'"
      ].join("\n")
    );
    await chmod(fakePdfToText, 0o755);
    process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ""}`;
    process.env.FINPROOF_PDFTOTEXT_PATH = fakePdfToText;

    try {
      const pipeline = createReviewAnalysisPipeline({
        fileBodyReader: {
          async getReviewFileBody(storageKey) {
            expect(storageKey).toBe("local/rc-upload-001/file-upload-001/ad.pdf");

            return new TextEncoder().encode("%PDF-1.7 searchable pdf fixture");
          }
        }
      });

      const artifacts = await pipeline.run({
        review: {
          ...review,
          files: [
            {
              ...review.files[0],
              name: "ad.pdf",
              storageProvider: "local",
              storageKey: "local/rc-upload-001/file-upload-001/ad.pdf",
              contentType: "application/pdf"
            }
          ]
        }
      });

      expect(artifacts.extractedDocuments).toEqual([
        expect.objectContaining({
          fileName: "ad.pdf",
          provider: "local-pdf-text-extractor",
          text: expect.stringContaining("누구나 최고 연 5.0%"),
          confidence: 0.94
        })
      ]);
      expect(artifacts.evidenceCandidates[0]).toEqual(
        expect.objectContaining({
          quoteSummary: expect.stringContaining("우대 조건 충족")
        })
      );
    } finally {
      process.env.PATH = originalPath;
      process.env.FINPROOF_PDFTOTEXT_PATH = originalPdfToTextPath;
      await rm(binDir, { recursive: true, force: true });
    }
  });

  it("does not route metadata-only notices to multilingual or domain agents when extracted text exists", async () => {
    const subAgentOrchestrator: ReviewSubAgentOrchestrator = {
      run: vi.fn(async () => [])
    };
    const provider: ModelProvider = {
      generateText: vi.fn(async () => ({
        provider: "fixture",
        model: "fixture",
        text: "[]"
      }))
    };
    const pipeline = createReviewAnalysisPipeline({
      modelProvider: provider,
      subAgentOrchestrator,
      ocrProvider: {
        async extract() {
          return [
            {
              fileId: "file-upload-archive",
              fileName: "package.zip",
              text: "CSV JSON Markdown uploaded body analysis unavailable",
              confidence: 0.62,
              provider: "metadata-only"
            },
            {
              fileId: "file-upload-001",
              fileName: "poster.txt",
              text: "누구나 최고 연 5.0% 우대 조건 충족 시 적용됩니다.",
              confidence: 0.96,
              provider: "local-text-extractor"
            }
          ];
        }
      }
    });

    const artifacts = await pipeline.run({ review });

    expect(artifacts.extractedDocuments).toEqual([
      expect.objectContaining({
        fileName: "poster.txt",
        provider: "local-text-extractor"
      })
    ]);
    expect(artifacts.multilingualSegments).toBeUndefined();
    expect(provider.generateText).not.toHaveBeenCalled();
    expect(subAgentOrchestrator.run).toHaveBeenCalledWith(
      expect.objectContaining({
        extractedDocuments: [
          expect.objectContaining({
            fileName: "poster.txt",
            provider: "local-text-extractor"
          })
        ]
      })
    );
  });

  it("extracts visual file text with Gemini OCR using inline file bytes", async () => {
    const pdfBytes = new TextEncoder().encode("%PDF-1.7 fake pdf bytes");
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      async json() {
        return {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      text: "최고 연 5.0%는 우대 조건 충족 시 적용됩니다.",
                      confidence: 0.93
                    })
                  }
                ]
              }
            }
          ]
        };
      }
    }));
    const provider = createGeminiOcrProvider(
      {
        GEMINI_API_KEY: "gemini-real",
        FINPROOF_OCR_MODEL: "gemini-2.5-flash-lite"
      },
      {
        async getReviewFileBody(storageKey) {
          expect(storageKey).toBe("s3://finproof-s3/reviews/rc-upload-001/file-upload-001/ad.pdf");

          return pdfBytes;
        }
      },
      fetchImpl
    );

    const documents = await provider.extract({
      review,
      files: [
        {
          ...review.files[0],
          name: "ad.pdf",
          contentType: "application/pdf",
          storageKey: "s3://finproof-s3/reviews/rc-upload-001/file-upload-001/ad.pdf"
        }
      ]
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "content-type": "application/json",
          "x-goog-api-key": "gemini-real"
        })
      })
    );
    const requestInit = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(requestInit.body)) as {
      contents: { parts: Array<Record<string, unknown>> }[];
    };
    expect(payload.contents[0]?.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          inlineData: {
            mimeType: "application/pdf",
            data: Buffer.from(pdfBytes).toString("base64")
          }
        })
      ])
    );
    expect(documents).toEqual([
      {
        fileId: "file-upload-001",
        fileName: "ad.pdf",
        storageKey: "s3://finproof-s3/reviews/rc-upload-001/file-upload-001/ad.pdf",
        text: "최고 연 5.0%는 우대 조건 충족 시 적용됩니다.",
        confidence: 0.93,
        provider: "gemini-ocr"
      }
    ]);
  });

  it("passes AbortSignal timeout to Gemini OCR fetch", async () => {
    const pdfBytes = new TextEncoder().encode("%PDF-1.7 fake");
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeDefined();
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({ text: "광고 텍스트", confidence: 0.9 })
                    }
                  ]
                }
              }
            ]
          };
        }
      };
    });

    const provider = createGeminiOcrProvider(
      { GEMINI_API_KEY: "test-key", FINPROOF_OCR_TIMEOUT_MS: "5000" },
      { async getReviewFileBody() { return pdfBytes; } },
      fetchImpl
    );

    await provider.extract({
      review,
      files: [
        {
          ...review.files[0],
          name: "ad.pdf",
          contentType: "application/pdf",
          storageKey: "s3://bucket/ad.pdf"
        }
      ]
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("falls back to Gemini OCR when a promotional PDF has too little embedded text", async () => {
    const binDir = await mkdtemp(path.join(tmpdir(), "finproof-pdftotext-short-"));
    const originalPdfToTextPath = process.env.FINPROOF_PDFTOTEXT_PATH;
    const fakePdfToText = path.join(binDir, "pdftotext");
    const pdfBytes = new TextEncoder().encode("%PDF-1.7 image-only poster pdf fixture");

    await writeFile(fakePdfToText, ["#!/bin/sh", "printf '%s\\n' 'x'"].join("\n"));
    await chmod(fakePdfToText, 0o755);
    process.env.FINPROOF_PDFTOTEXT_PATH = fakePdfToText;

    try {
      const fetchImpl = vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        text: "포스터 PDF 이미지에서 OCR로 읽은 최고 연 5.20% 문구",
                        confidence: 0.91
                      })
                    }
                  ]
                }
              }
            ]
          };
        }
      }));
      const provider = createGeminiOcrProvider(
        {
          GEMINI_API_KEY: "gemini-real",
          FINPROOF_OCR_MODEL: "gemini-2.5-flash-lite"
        },
        {
          async getReviewFileBody() {
            return pdfBytes;
          }
        },
        fetchImpl
      );

      const documents = await provider.extract({
        review,
        files: [
          {
            ...review.files[0],
            name: "poster.pdf",
            fileType: "promotional_creative",
            contentType: "application/pdf",
            storageKey: "local/rc-upload-001/poster.pdf"
          }
        ]
      });

      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(documents).toEqual([
        expect.objectContaining({
          fileName: "poster.pdf",
          provider: "gemini-ocr",
          text: "포스터 PDF 이미지에서 OCR로 읽은 최고 연 5.20% 문구",
          confidence: 0.91
        })
      ]);
    } finally {
      process.env.FINPROOF_PDFTOTEXT_PATH = originalPdfToTextPath;
      await rm(binDir, { recursive: true, force: true });
    }
  });

  it("prioritizes extracted document text over metadata-only archive entries", async () => {
    const pipeline = createReviewAnalysisPipeline({
      ocrProvider: {
        async extract() {
          return [
            {
              fileId: "file-upload-001",
              fileName: "package.zip",
              text: "파일명: package.zip 본문 추출 대상이 아닙니다.",
              confidence: 0.62,
              provider: "metadata-only"
            },
            {
              fileId: "file-upload-002",
              fileName: "poster.txt",
              text: "누구나 받을 수 있는 최고 연 5.0% 적금. 우대 조건 충족 시 적용됩니다.",
              confidence: 0.96,
              provider: "local-text-extractor"
            }
          ];
        }
      }
    });

    const artifacts = await pipeline.run({ review });

    expect(artifacts.evidenceCandidates[0]).toEqual(
      expect.objectContaining({
        title: "poster.txt",
        quoteSummary: expect.stringContaining("최고 연 5.0%")
      })
    );
  });

  it("retrieves approved knowledge evidence and reranks every RAG candidate", async () => {
    const scope: ReviewStoreScope = {
      tenantId: "tenant-demo",
      actorUserId: "user-reviewer-demo",
      actorRole: "reviewer"
    };
    const searchKnowledgeEvidence = vi.fn(async () => [
      {
        id: "knowledge-evidence-001",
        sourceType: "internal_policy" as const,
        documentId: "knowledge-001",
        chunkId: "chunk-knowledge-001-001",
        title: "예금 광고 심의 지침",
        version: "2026.05",
        effectiveFrom: "2026-05-01",
        quoteSummary: "최고 금리 표현은 우대 조건과 한도를 같은 화면에 표시해야 합니다.",
        relevanceScore: 0.88
      }
    ]);
    const rerank = vi.fn(async ({ candidates }) =>
      [...candidates].sort((left, right) =>
        left.sourceType === "internal_policy" ? -1 : right.sourceType === "internal_policy" ? 1 : 0
      )
    );
    const pipeline = createReviewAnalysisPipeline({
      reviewStore: { searchKnowledgeEvidence },
      reranker: {
        provider: "fixture-reranker",
        rerank
      },
      ocrProvider: {
        async extract(input) {
          return input.files.map((file) => ({
            fileId: file.id,
            fileName: file.name,
            storageKey: file.storageKey,
            text: "누구나 최고 연 5.0% 우대 조건 충족 시 적용됩니다.",
            confidence: 0.94,
            provider: "fixture-ocr"
          }));
        }
      }
    });

    const artifacts = await pipeline.run({ review, scope });

    expect(searchKnowledgeEvidence).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({
        query: expect.stringContaining("최고 연 5.0%"),
        productType: "deposit",
        topK: expect.any(Number)
      })
    );
    expect(rerank).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining("최고 연 5.0%"),
        candidates: expect.arrayContaining([
          expect.objectContaining({ sourceType: "product_doc" }),
          expect.objectContaining({ sourceType: "internal_policy" })
        ])
      })
    );
    expect(artifacts.evidenceCandidates[0]).toMatchObject({
      sourceType: "internal_policy",
      chunkId: "chunk-knowledge-001-001"
    });
  });

  it("retrieves case history evidence from the review store when a scoped analysis runs", async () => {
    const scope: ReviewStoreScope = {
      tenantId: "tenant-demo",
      actorUserId: "user-reviewer-demo",
      actorRole: "reviewer"
    };
    const searchKnowledgeEvidence = vi.fn(async () => []);
    const searchCaseHistoryEvidence = vi.fn(async () => [
      {
        id: "case-history-evidence-001",
        sourceType: "case_history" as const,
        documentId: "rc-2025-014",
        title: "CASE-2025-014",
        quoteSummary: "유사한 최고금리 표현이 조건 고지 위치 문제로 수정 요청되었습니다.",
        relevanceScore: 0.9
      }
    ]);
    const provider: ModelProvider = {
      generateText: vi.fn(async ({ task }) => ({
        provider: "openai",
        model: "gpt-5.2",
        text:
          task === "creative_review"
            ? JSON.stringify([
                {
                  title: "최고 금리 조건 병기 필요",
                  riskLevel: "high",
                  targetText: "누구나 최고 연 5.0%",
                  description: "절대 표현과 최고 금리 표현이 함께 있어 조건 고지가 필요합니다.",
                  suggestedAction: "change_request",
                  suggestedCopy: "조건 충족 시 최고 연 5.0%로 문구를 조정해 주세요.",
                  evidenceCandidateIds: ["case-history-evidence-001"],
                  confidence: 0.86
                }
              ])
            : "[]"
      }))
    };
    const pipeline = createReviewAnalysisPipeline({
      modelProvider: provider,
      reviewStore: {
        searchKnowledgeEvidence,
        searchCaseHistoryEvidence
      },
      ocrProvider: {
        async extract(input) {
          return input.files.map((file) => ({
            fileId: file.id,
            fileName: file.name,
            storageKey: file.storageKey,
            text: "누구나 최고 연 5.0% 우대 조건 충족 시 적용됩니다.",
            confidence: 0.94,
            provider: "fixture-ocr"
          }));
        }
      }
    });

    const artifacts = await pipeline.run({ review, scope });

    expect(searchCaseHistoryEvidence).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({
        query: expect.stringContaining("최고 연 5.0%"),
        productType: "deposit",
        excludeReviewCaseId: "rc-upload-001"
      })
    );
    expect(artifacts.evidenceCandidates).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceType: "case_history" })])
    );
    expect(provider.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "case_search"
      })
    );
  });

  it("runs the default domain review subagents and stores their findings", async () => {
    const provider: ModelProvider = {
      generateText: vi
        .fn()
        .mockResolvedValueOnce({
          provider: "openai",
          model: "gpt-5.2",
          text: JSON.stringify([
            {
              title: "최고 금리 조건 병기 필요",
              riskLevel: "high",
              targetText: "누구나 최고 연 5.0%",
              description: "절대 표현과 최고 금리 표현이 함께 있어 조건 고지가 필요합니다.",
              suggestedAction: "change_request",
              suggestedCopy: "최고 연 5.0%는 우대 조건 충족 시 적용됩니다.",
              evidenceCandidateIds: ["evidence-candidate-file-upload-001-001"],
              confidence: 0.88
            }
          ])
        })
        .mockResolvedValue({
          provider: "openai",
          model: "gpt-5.2",
          text: "[]"
        })
    };
    const pipeline = createReviewAnalysisPipeline({
      modelProvider: provider,
      ocrProvider: {
        async extract(input) {
          return input.files.map((file) => ({
            fileId: file.id,
            fileName: file.name,
            storageKey: file.storageKey,
            text: "누구나 최고 연 5.0% 우대 조건 충족 시 적용됩니다.",
            confidence: 0.94,
            provider: "fixture-ocr"
          }));
        }
      }
    });

    const artifacts = await pipeline.run({ review });

    expect(provider.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "creative_review",
        routeContext: expect.objectContaining({
          riskLevel: "info"
        })
      })
    );
    expect(provider.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "product_terms"
      })
    );
    expect(provider.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "regulation_agent"
      })
    );
    expect(provider.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "internal_policy_agent"
      })
    );
    expect(provider.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "evidence_verification"
      })
    );
    expect(artifacts.agentFindings).toEqual([
      expect.objectContaining({
        agent: "creative_review",
        title: "최고 금리 조건 병기 필요",
        evidenceCandidateIds: ["evidence-candidate-file-upload-001-001"]
      })
    ]);
  });

  it("still runs the main compliance lead agent when low-risk domain findings are strongly evidenced", async () => {
    const provider: ModelProvider = {
      generateText: vi.fn(async ({ task }) => ({
        provider: "openai",
        model: "gpt-5.2",
        text:
          task === "creative_review"
            ? JSON.stringify([
                {
                  title: "혜택 조건 문구 확인",
                  riskLevel: "caution",
                  targetText: "최고 연 5.0%",
                  description: "조건 문구가 함께 있어 주의 수준으로 확인합니다.",
                  suggestedAction: "hold",
                  suggestedCopy: "우대 조건 충족 시 적용된다는 문구를 유지해 주세요.",
                  evidenceCandidateIds: ["evidence-candidate-file-upload-001-001"],
                  confidence: 0.91
                }
              ])
            : "[]"
      }))
    };
    const pipeline = createReviewAnalysisPipeline({
      modelProvider: provider,
      ocrProvider: {
        async extract(input) {
          return input.files.map((file) => ({
            fileId: file.id,
            fileName: file.name,
            storageKey: file.storageKey,
            text: "최고 연 5.0% 우대 조건 충족 시 적용됩니다.",
            confidence: 0.97,
            provider: "fixture-ocr"
          }));
        }
      }
    });

    await pipeline.run({ review });

    const calledTasks = (provider.generateText as ReturnType<typeof vi.fn>).mock.calls.map(
      ([input]) => input.task
    );
    expect(calledTasks).toEqual([
      "creative_review",
      "product_terms",
      "regulation_agent",
      "internal_policy_agent",
      "main_compliance"
    ]);
  });

  it("uses the main compliance lead agent for final risk judgment after conditional quality agents", async () => {
    const provider: ModelProvider = {
      generateText: vi.fn(async ({ task }) => {
        if (task === "creative_review") {
          return {
            provider: "openai",
            model: "gpt-5.2",
            text: JSON.stringify([
              {
                title: "절대 표현과 금리 강조 충돌",
                issueType: "ai_creative_review",
                riskLevel: "high",
                targetText: "누구나 최고 연 5.0%",
                description: "절대 표현과 최고 금리 표현이 함께 있어 소비자 오인 가능성이 큽니다.",
                suggestedAction: "change_request",
                suggestedCopy: "조건 충족 시 최고 연 5.0%로 문구를 조정해 주세요.",
                evidenceCandidateIds: ["evidence-candidate-file-upload-001-001"],
                confidence: 0.88
              }
            ])
          };
        }

        if (task === "product_terms") {
          return {
            provider: "openai",
            model: "gpt-5.2",
            text: JSON.stringify([
              {
                title: "상품자료상 조건 병기됨",
                issueType: "ai_product_terms",
                riskLevel: "info",
                targetText: "우대 조건 충족 시 적용",
                description: "상품자료에는 우대 조건이 확인됩니다.",
                suggestedAction: "hold",
                suggestedCopy: "조건 문구의 위치와 크기를 확인해 주세요.",
                evidenceCandidateIds: ["case-history-evidence-001"],
                confidence: 0.86
              }
            ])
          };
        }

        if (task === "main_compliance") {
          return {
            provider: "openai",
            model: "gpt-5.4",
            text: JSON.stringify([
              {
                title: "팀장 검토: 최고 금리 표현 수정 필요",
                issueType: "ai_main_compliance",
                riskLevel: "reject_recommended",
                targetText: "누구나 최고 연 5.0%",
                description:
                  "홍보물의 절대 표현과 상품자료 조건, 유사 사례를 종합하면 수정 전 승인은 어렵습니다.",
                suggestedAction: "reject",
                suggestedCopy:
                  "조건 충족 시 최고 연 5.0%로 문구를 조정하고 우대 조건을 인접 표시해 주세요.",
                evidenceCandidateIds: [
                  "evidence-candidate-file-upload-001-001",
                  "case-history-evidence-001"
                ],
                confidence: 0.91
              }
            ])
          };
        }

        return {
          provider: "openai",
          model: "gpt-5.2",
          text: "[]"
        };
      })
    };
    const pipeline = createReviewAnalysisPipeline({
      modelProvider: provider,
      ragRetriever: {
        async retrieve() {
          return [
            {
              id: "evidence-candidate-file-upload-001-001",
              sourceType: "product_doc",
              title: "poster.png",
              quoteSummary: "누구나 최고 연 5.0% 우대 조건 충족 시 적용됩니다.",
              relevanceScore: 0.94,
              sourceFileId: "file-upload-001"
            },
            {
              id: "case-history-evidence-001",
              sourceType: "case_history",
              documentId: "rc-2025-014",
              title: "CASE-2025-014",
              quoteSummary: "유사 금리 표현이 조건 고지 위치 문제로 수정 요청되었습니다.",
              relevanceScore: 0.89
            }
          ];
        }
      },
      ocrProvider: {
        async extract(input) {
          return input.files.map((file) => ({
            fileId: file.id,
            fileName: file.name,
            storageKey: file.storageKey,
            text: "누구나 최고 연 5.0% 우대 조건 충족 시 적용됩니다.",
            confidence: 0.93,
            provider: "fixture-ocr"
          }));
        }
      }
    });

    const artifacts = await pipeline.run({ review });

    const calledTasks = (provider.generateText as ReturnType<typeof vi.fn>).mock.calls.map(
      ([input]) => input.task
    );
    expect(calledTasks).toEqual([
      "creative_review",
      "product_terms",
      "regulation_agent",
      "internal_policy_agent",
      "evidence_verification",
      "case_search",
      "main_compliance"
    ]);
    expect(provider.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "case_search",
        routeContext: expect.objectContaining({
          caseStronglyInfluencesJudgment: true
        })
      })
    );
    expect(provider.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "main_compliance",
        routeContext: expect.objectContaining({
          riskLevel: "high"
        })
      })
    );
    const mainComplianceInput = (provider.generateText as ReturnType<typeof vi.fn>).mock.calls.find(
      ([input]) => input.task === "main_compliance"
    )?.[0].input;
    expect(JSON.parse(String(mainComplianceInput))).toEqual(
      expect.objectContaining({
        priorFindings: expect.arrayContaining([
          expect.objectContaining({ agent: "creative_review", riskLevel: "high" }),
          expect.objectContaining({ agent: "product_terms", riskLevel: "info" })
        ])
      })
    );
    expect(artifacts.agentFindings).toEqual([
      expect.objectContaining({
        agent: "main",
        riskLevel: "reject_recommended",
        title: "팀장 검토: 최고 금리 표현 수정 필요"
      })
    ]);
  });

  it("integrates English multilingual findings before domain subagents run", async () => {
    const provider = multilingualProviderReturning({
      english_translator_risk: JSON.stringify({
        findings: [
          {
            segmentId: "seg-en-001",
            language: "en",
            originalText: "Guaranteed approval in 3 minutes",
            literalTranslation: "3분 내 승인 보장",
            complianceMeaning: "대출 승인 여부가 확정된 것처럼 표현합니다.",
            riskCategory: "both",
            riskSignals: ["guaranteed approval"],
            riskLevelHint: "high",
            suggestedCopyOriginalLanguage: "Approval may vary after review.",
            suggestedCopyKoreanMeaning: "승인은 심사 후 달라질 수 있습니다.",
            confidence: 0.89
          }
        ]
      }),
      korean_compliance_mapping: JSON.stringify({
        mappings: [
          {
            localizedFindingId: "seg-en-001",
            issueType: "MULTILINGUAL_APPROVAL_GUARANTEE",
            koreanComplianceCategory: "대출 승인 보장 표현",
            koreanComplianceReason: "심사 전 승인 확정 표현은 오인 가능성이 큽니다.",
            evidenceQuery: "대출 승인 보장 금융광고",
            suggestedAction: "reject"
          }
        ]
      })
    });
    const subAgentOrchestrator: ReviewSubAgentOrchestrator = {
      run: vi.fn(async () => [])
    };
    const pipeline = createReviewAnalysisPipeline({
      modelProvider: provider,
      subAgentOrchestrator,
      ocrProvider: fixedOcrProvider("Guaranteed approval in 3 minutes")
    });

    const artifacts = await pipeline.run({ review });

    expect(artifacts.multilingualSegments?.map((segment) => segment.language)).toEqual(["en"]);
    expect(artifacts.localizedRiskFindings?.[0]?.originalText).toBe(
      "Guaranteed approval in 3 minutes"
    );
    expect(subAgentOrchestrator.run).toHaveBeenCalledWith(
      expect.objectContaining({
        priorFindings: expect.arrayContaining([
          expect.objectContaining({
            agent: "korean_compliance_mapping",
            targetText: "Guaranteed approval in 3 minutes"
          })
        ])
      })
    );
  });

  it("routes Japanese OCR text through the Japanese translator risk agent", async () => {
    const provider = multilingualProviderReturning({
      japanese_translator_risk: "[]"
    });
    const pipeline = createReviewAnalysisPipeline({
      modelProvider: provider,
      subAgentOrchestrator: emptySubAgentOrchestrator(),
      ocrProvider: fixedOcrProvider("最短3分で審査完了")
    });

    await pipeline.run({ review });

    expect(provider.calls).toEqual(["japanese_translator_risk"]);
  });

  it("routes Chinese OCR text through the Chinese translator risk agent", async () => {
    const provider = multilingualProviderReturning({
      chinese_translator_risk: "[]"
    });
    const pipeline = createReviewAnalysisPipeline({
      modelProvider: provider,
      subAgentOrchestrator: emptySubAgentOrchestrator(),
      ocrProvider: fixedOcrProvider("最低利率 无需审核")
    });

    await pipeline.run({ review });

    expect(provider.calls).toEqual(["chinese_translator_risk"]);
  });

  it("routes mixed English Japanese and Chinese OCR text through all multilingual agents and mapping", async () => {
    const provider = multilingualProviderReturning({
      english_translator_risk: localizedFindingOutput({
        segmentId: "seg-en-001",
        language: "en",
        originalText: "Guaranteed approval in 3 minutes"
      }),
      japanese_translator_risk: localizedFindingOutput({
        segmentId: "seg-ja-001",
        language: "ja",
        originalText: "最短3分で審査完了"
      }),
      chinese_translator_risk: localizedFindingOutput({
        segmentId: "seg-zh-001",
        language: "zh",
        originalText: "最低利率 无需审核"
      }),
      korean_compliance_mapping: JSON.stringify({
        mappings: [
          {
            localizedFindingId: "seg-en-001",
            issueType: "MULTILINGUAL_APPROVAL_GUARANTEE",
            koreanComplianceCategory: "다국어 승인 확정 표현",
            koreanComplianceReason: "심사 전 승인 확정 표현은 오인 가능성이 큽니다.",
            evidenceQuery: "승인 보장 금융광고",
            suggestedAction: "reject"
          },
          {
            localizedFindingId: "seg-ja-001",
            issueType: "MULTILINGUAL_FAST_REVIEW",
            koreanComplianceCategory: "다국어 심사 속도 표현",
            koreanComplianceReason: "심사 완료 시점을 단정해 오인 가능성이 있습니다.",
            evidenceQuery: "심사 완료 단정 금융광고",
            suggestedAction: "change_request"
          },
          {
            localizedFindingId: "seg-zh-001",
            issueType: "MULTILINGUAL_NO_SCREENING",
            koreanComplianceCategory: "다국어 무심사 표현",
            koreanComplianceReason: "심사 없이 가능하다는 표현은 대출 조건 오인 위험이 있습니다.",
            evidenceQuery: "무심사 대출 금융광고",
            suggestedAction: "reject"
          }
        ]
      })
    });
    const pipeline = createReviewAnalysisPipeline({
      modelProvider: provider,
      subAgentOrchestrator: emptySubAgentOrchestrator(),
      ocrProvider: fixedOcrProvider(
        "Guaranteed approval in 3 minutes 最短3分で審査完了 最低利率 无需审核"
      )
    });

    await pipeline.run({ review });

    expect(provider.calls).toEqual([
      "english_translator_risk",
      "japanese_translator_risk",
      "chinese_translator_risk",
      "korean_compliance_mapping"
    ]);
  });

  it("keeps Korean-only OCR unchanged and skips multilingual model tasks", async () => {
    const provider = multilingualProviderReturning({});
    const pipeline = createReviewAnalysisPipeline({
      modelProvider: provider,
      subAgentOrchestrator: emptySubAgentOrchestrator(),
      ocrProvider: fixedOcrProvider("최고 연 5.0% 우대금리는 급여이체 조건 충족 시 제공됩니다.")
    });

    const artifacts = await pipeline.run({ review });

    expect(artifacts.multilingualSegments).toBeUndefined();
    expect(provider.calls).not.toEqual(
      expect.arrayContaining([
        "english_translator_risk",
        "japanese_translator_risk",
        "chinese_translator_risk",
        "korean_compliance_mapping"
      ])
    );
  });

  it("preserves multilingual source agent context when issues convert to finding candidates", async () => {
    const provider = multilingualProviderReturning({
      english_translator_risk: JSON.stringify({
        findings: [
          {
            segmentId: "seg-en-001",
            language: "en",
            originalText: "Guaranteed approval in 3 minutes",
            literalTranslation: "3분 내 승인 보장",
            complianceMeaning: "대출 승인 여부가 확정된 것처럼 표현합니다.",
            riskCategory: "both",
            riskSignals: ["guaranteed approval"],
            riskLevelHint: "high",
            suggestedCopyOriginalLanguage: "Approval may vary after review.",
            suggestedCopyKoreanMeaning: "승인은 심사 후 달라질 수 있습니다.",
            confidence: 0.81
          }
        ]
      }),
      korean_compliance_mapping: JSON.stringify({
        mappings: [
          {
            localizedFindingId: "seg-en-001",
            issueType: "MULTILINGUAL_APPROVAL_GUARANTEE",
            koreanComplianceCategory: "대출 승인 보장 표현",
            koreanComplianceReason: "심사 전 승인 확정 표현은 오인 가능성이 큽니다.",
            evidenceQuery: "대출 승인 보장 금융광고",
            suggestedAction: "change_request"
          }
        ]
      })
    });
    const pipeline = createReviewAnalysisPipeline({
      modelProvider: provider,
      subAgentOrchestrator: passthroughPriorFindingOrchestrator(),
      ocrProvider: fixedOcrProvider("Guaranteed approval in 3 minutes")
    });

    const artifacts = await pipeline.run({ review });

    expect(artifacts.findings?.[0]).toMatchObject({
      agentType: "korean_compliance_mapping",
      targetText: "Guaranteed approval in 3 minutes",
      localizedRiskFinding: {
        originalText: "Guaranteed approval in 3 minutes"
      },
      koreanComplianceMapping: {
        issueType: "MULTILINGUAL_APPROVAL_GUARANTEE"
      }
    });
  });

  it("keeps multilingual prior findings when the real orchestrator returns main findings", async () => {
    const provider = multilingualProviderReturning({
      english_translator_risk: JSON.stringify({
        findings: [
          {
            segmentId: "seg-en-001",
            language: "en",
            originalText: "Guaranteed approval in 3 minutes",
            literalTranslation: "3분 내 승인 보장",
            complianceMeaning: "대출 승인 여부가 확정된 것처럼 표현합니다.",
            riskCategory: "both",
            riskSignals: ["guaranteed approval"],
            riskLevelHint: "high",
            suggestedCopyOriginalLanguage: "Approval may vary after review.",
            suggestedCopyKoreanMeaning: "승인은 심사 후 달라질 수 있습니다.",
            confidence: 0.88
          }
        ]
      }),
      korean_compliance_mapping: JSON.stringify({
        mappings: [
          {
            localizedFindingId: "seg-en-001",
            issueType: "MULTILINGUAL_APPROVAL_GUARANTEE",
            koreanComplianceCategory: "대출 승인 보장 표현",
            koreanComplianceReason: "심사 전 승인 확정 표현은 오인 가능성이 큽니다.",
            evidenceQuery: "guaranteed approval",
            suggestedAction: "change_request"
          }
        ]
      }),
      main_compliance: JSON.stringify([
        {
          title: "팀장 검토: 승인 보장 표현 수정 필요",
          issueType: "ai_main_compliance",
          riskLevel: "high",
          targetText: "Guaranteed approval in 3 minutes",
          description: "대출 승인 보장 표현은 심사 조건을 오인시킬 수 있습니다.",
          suggestedAction: "change_request",
          suggestedCopy: "Approval is subject to review.",
          evidenceCandidateIds: ["evidence-candidate-file-upload-001-001"],
          confidence: 0.9
        }
      ])
    });
    const pipeline = createReviewAnalysisPipeline({
      modelProvider: provider,
      ocrProvider: fixedOcrProvider("Guaranteed approval in 3 minutes")
    });

    const artifacts = await pipeline.run({ review });

    expect(artifacts.agentFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agent: "korean_compliance_mapping",
          localizedRiskFinding: expect.objectContaining({
            originalText: "Guaranteed approval in 3 minutes"
          }),
          koreanComplianceMapping: expect.objectContaining({
            issueType: "MULTILINGUAL_APPROVAL_GUARANTEE"
          })
        }),
        expect.objectContaining({
          agent: "main",
          title: "팀장 검토: 승인 보장 표현 수정 필요"
        })
      ])
    );
    expect(artifacts.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentType: "korean_compliance_mapping",
          localizedRiskFinding: expect.objectContaining({
            originalText: "Guaranteed approval in 3 minutes"
          }),
          koreanComplianceMapping: expect.objectContaining({
            issueType: "MULTILINGUAL_APPROVAL_GUARANTEE"
          })
        })
      ])
    );
  });
});

function fixedOcrProvider(text: string) {
  return {
    async extract(input: { files: typeof review.files }) {
      return input.files.map((file) => ({
        fileId: file.id,
        fileName: file.name,
        storageKey: file.storageKey,
        text,
        confidence: 0.94,
        provider: "fixture-ocr"
      }));
    }
  };
}

function emptySubAgentOrchestrator(): ReviewSubAgentOrchestrator {
  return {
    run: vi.fn(async () => [])
  };
}

function passthroughPriorFindingOrchestrator(): ReviewSubAgentOrchestrator {
  return {
    run: vi.fn(async ({ priorFindings = [] }) => priorFindings)
  };
}

function multilingualProviderReturning(
  outputs: Record<string, string | Error>
): ModelProvider & { calls: string[] } {
  const calls: string[] = [];

  return {
    calls,
    generateText: vi.fn(async ({ task }) => {
      calls.push(String(task));
      const output = outputs[String(task)] ?? "[]";

      if (output instanceof Error) {
        throw output;
      }

      return {
        provider: "deterministic",
        model: "fixture",
        text: output
      };
    })
  };
}

function localizedFindingOutput({
  segmentId,
  language,
  originalText
}: {
  segmentId: string;
  language: "en" | "ja" | "zh";
  originalText: string;
}) {
  return JSON.stringify({
    findings: [
      {
        segmentId,
        language,
        originalText,
        literalTranslation: "번역 문구",
        complianceMeaning: "외국어 금융 광고 표현에 오인 가능성이 있습니다.",
        riskCategory: "both",
        riskSignals: ["approval"],
        riskLevelHint: "high",
        suggestedCopyOriginalLanguage: "Review conditions apply.",
        suggestedCopyKoreanMeaning: "조건에 따라 달라질 수 있습니다.",
        confidence: 0.86
      }
    ]
  });
}
