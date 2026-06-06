import { segmentMultilingualDocuments } from "./multilingual";
import type { ExtractedDocument } from "./review-analysis-pipeline";

function document(text: string): ExtractedDocument {
  return {
    fileId: "file-1",
    fileName: "poster.txt",
    text,
    confidence: 0.94,
    provider: "local-text-extractor"
  };
}

describe("segmentMultilingualDocuments", () => {
  it("detects English risk copy and preserves the original text", () => {
    const segments = segmentMultilingualDocuments([
      document("대출 광고\nGuaranteed approval in 3 minutes\n금리는 심사 후 확정")
    ]);

    expect(segments).toEqual([
      expect.objectContaining({
        id: "seg-en-001",
        language: "en",
        originalText: "Guaranteed approval in 3 minutes",
        normalizedText: "Guaranteed approval in 3 minutes",
        sourceFileId: "file-1",
        confidence: 0.94
      })
    ]);
  });

  it("detects Japanese and Chinese as separate supported languages", () => {
    const segments = segmentMultilingualDocuments([
      document("最短3分で審査完了\n最低利率 无需审核")
    ]);

    expect(segments.map((segment) => segment.language)).toEqual(["ja", "zh"]);
    expect(segments[0]).toMatchObject({
      id: "seg-ja-001",
      originalText: "最短3分で審査完了"
    });
    expect(segments[1]).toMatchObject({
      id: "seg-zh-001",
      originalText: "最低利率 无需审核"
    });
  });

  it("splits mixed English Japanese and Chinese copy on a collapsed OCR line", () => {
    const segments = segmentMultilingualDocuments([
      document("Guaranteed approval 最短3分で審査完了 最低利率 无需审核")
    ]);

    expect(segments.map((segment) => segment.language)).toEqual(["en", "ja", "zh"]);
    expect(segments).toEqual([
      expect.objectContaining({
        id: "seg-en-001",
        originalText: "Guaranteed approval"
      }),
      expect.objectContaining({
        id: "seg-ja-001",
        originalText: "最短3分で審査完了"
      }),
      expect.objectContaining({
        id: "seg-zh-001",
        originalText: "最低利率 无需审核"
      })
    ]);
  });

  it("routes Han-only Japanese financial ad terms to Japanese", () => {
    const segments = segmentMultilingualDocuments([
      document("審査完了\n手数料無料\n金利優遇\n最低利率 无需审核")
    ]);

    expect(segments.map((segment) => segment.language)).toEqual(["ja", "ja", "ja", "zh"]);
    expect(segments[0]).toMatchObject({
      id: "seg-ja-001",
      originalText: "審査完了"
    });
    expect(segments[1]).toMatchObject({
      id: "seg-ja-002",
      originalText: "手数料無料"
    });
    expect(segments[2]).toMatchObject({
      id: "seg-ja-003",
      originalText: "金利優遇"
    });
    expect(segments[3]).toMatchObject({
      id: "seg-zh-001",
      originalText: "最低利率 无需审核"
    });
  });

  it("skips Korean-only review copy", () => {
    expect(
      segmentMultilingualDocuments([document("최고 연 5.0% 금리는 우대 조건 충족 시 적용됩니다.")])
    ).toEqual([]);
  });

  it("keeps a mixed Korean and English line when foreign copy is present", () => {
    const segments = segmentMultilingualDocuments([
      document("혜택 문구: No hidden fees for every customer")
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      language: "en",
      originalText: "혜택 문구: No hidden fees for every customer"
    });
  });

  it("ignores Korean review package metadata lines with technical English tokens", () => {
    expect(
      segmentMultilingualDocuments([
        document(
          [
            "FinProof 요청 제출 조건 확인서 productType=loan 필수자료 및 파일 분류 매핑",
            "SamplePackageSelector.tsx에서 fileType 기준으로 promotional_creative, rate_table을 확인합니다."
          ].join("\n")
        )
      ])
    ).toEqual([]);
  });
});
