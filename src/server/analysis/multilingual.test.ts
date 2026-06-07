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

  it("detects Vietnamese Myanmar and Khmer as separate supported languages", () => {
    const segments = segmentMultilingualDocuments([
      document(
        "Phê duyệt khoản vay trong 3 phút\nချေးငွေ အတည်ပြုချက် ၃ မိနစ်အတွင်း\nអនុម័តប្រាក់កម្ចីក្នុង ៣ នាទី"
      )
    ]);

    expect(segments.map((segment) => segment.language)).toEqual(["vi", "my", "km"]);
    expect(segments[0]).toMatchObject({
      id: "seg-vi-001",
      originalText: "Phê duyệt khoản vay trong 3 phút"
    });
    expect(segments[1]).toMatchObject({
      id: "seg-my-001",
      originalText: "ချေးငွေ အတည်ပြုချက် ၃ မိနစ်အတွင်း"
    });
    expect(segments[2]).toMatchObject({
      id: "seg-km-001",
      originalText: "អនុម័តប្រាក់កម្ចីក្នុង ៣ នាទី"
    });
  });

  it("splits mixed English Vietnamese Myanmar and Khmer copy on a collapsed OCR line", () => {
    const segments = segmentMultilingualDocuments([
      document(
        "Guaranteed approval Phê duyệt khoản vay ချေးငွေ အတည်ပြုချက် អនុម័តប្រាក់កម្ចី"
      )
    ]);

    expect(segments.map((segment) => segment.language)).toEqual(["en", "vi", "my", "km"]);
    expect(segments).toEqual([
      expect.objectContaining({
        id: "seg-en-001",
        originalText: "Guaranteed approval"
      }),
      expect.objectContaining({
        id: "seg-vi-001",
        originalText: "Phê duyệt khoản vay"
      }),
      expect.objectContaining({
        id: "seg-my-001",
        originalText: "ချေးငွေ အတည်ပြုချက်"
      }),
      expect.objectContaining({
        id: "seg-km-001",
        originalText: "អនុម័តប្រាក់កម្ចី"
      })
    ]);
  });

  it("does not detect Japanese or Chinese as supported multilingual review languages", () => {
    const segments = segmentMultilingualDocuments([
      document("審査完了\n手数料無料\n金利優遇\n最低利率 无需审核")
    ]);

    expect(segments).toEqual([]);
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
