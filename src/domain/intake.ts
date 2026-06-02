import type { ProductType, ReviewCase, ReviewFile } from "./types";
import { getReviewCaseById, reviewCases, riskLabels } from "./reviews";

type RequiredMaterial = {
  label: string;
  fileType: ReviewFile["fileType"];
  missingKey?: string;
};

export type SamplePackage = {
  id: string;
  label: string;
  title: string;
  affiliate: string;
  productType: ProductType;
  highestRiskLabel: string;
  summary: string;
};

export type SamplePackagePreview = {
  reviewCaseId: string;
  title: string;
  affiliate: string;
  productType: ProductType;
  files: ReviewFile[];
  missingMaterials: string[];
  issueCount: number;
  analysisStartHref: string;
};

export type RequiredMaterialRow = {
  label: string;
  fileType: ReviewFile["fileType"];
  status: "present" | "missing";
};

const packageLabels: Record<ProductType, string> = {
  deposit: "예금/적금 샘플 패키지",
  loan: "대출 샘플 패키지",
  card: "카드 샘플 패키지",
  capital: "캐피탈 샘플 패키지",
  insurance: "보험 샘플 패키지",
  investment: "투자상품 샘플 패키지",
  image_test: "이미지 테스트 패키지"
};

const requiredMaterials: Partial<Record<ProductType, RequiredMaterial[]>> = {
  deposit: [
    { label: "홍보물 시안", fileType: "promotional_creative" },
    { label: "원문 카피", fileType: "copy_draft" },
    { label: "상품 설명서", fileType: "product_description" },
    { label: "금리표", fileType: "rate_table" },
    { label: "내부 체크리스트", fileType: "checklist", missingKey: "internal_checklist" }
  ],
  loan: [
    { label: "홍보물 시안", fileType: "promotional_creative" },
    { label: "원문 카피", fileType: "copy_draft" },
    { label: "상품 설명서", fileType: "product_description" },
    { label: "금리표", fileType: "rate_table" },
    { label: "약관/대출 조건", fileType: "terms" },
    { label: "내부 체크리스트", fileType: "checklist", missingKey: "internal_checklist" }
  ],
  image_test: [
    { label: "홍보 이미지", fileType: "promotional_creative" }
  ]
};

export function getSamplePackages(): SamplePackage[] {
  return reviewCases.map((review) => ({
    id: review.id,
    label: packageLabels[review.productType],
    title: review.title,
    affiliate: review.affiliate,
    productType: review.productType,
    highestRiskLabel: riskLabels[review.highestRiskLevel],
    summary: `${review.files.length}개 파일 · ${review.issues.length}개 AI 위험 후보`
  }));
}

export function buildSamplePackagePreview(id: string): SamplePackagePreview | undefined {
  const review = getReviewCaseById(id);

  if (!review) {
    return undefined;
  }

  return {
    reviewCaseId: review.id,
    title: review.title,
    affiliate: review.affiliate,
    productType: review.productType,
    files: review.files,
    missingMaterials: review.missingMaterials,
    issueCount: review.issues.length,
    analysisStartHref: `/reviews/${review.id}`
  };
}

export function getRequiredMaterialRows(
  review: Pick<ReviewCase, "productType" | "files">
): RequiredMaterialRow[] {
  const materials = requiredMaterials[review.productType];

  if (!materials) {
    return [];
  }

  return materials.map((material) => ({
    label: material.label,
    fileType: material.fileType,
    status: review.files.some((file) => file.fileType === material.fileType) ? "present" : "missing"
  }));
}
