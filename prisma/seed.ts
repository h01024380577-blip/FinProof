import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import sampleReviewCases from "../src/data/sample-review-cases.json";
import type { ReviewCase } from "../src/domain/types";
import { PrismaClient } from "../src/generated/prisma/client";

const connectionString = process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();

if (!connectionString) {
  throw new Error("DIRECT_URL or DATABASE_URL is required to seed FinProof demo data");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString })
});

const cases = sampleReviewCases as ReviewCase[];

const affiliateSeeds = [
  { id: "aff-gwangju-bank", code: "gwangju-bank", name: "광주은행" },
  { id: "aff-jeonbuk-bank", code: "jeonbuk-bank", name: "전북은행" },
  { id: "aff-ppc-bank", code: "ppc-bank", name: "PPCBank" },
  {
    id: "aff-jb-securities-vietnam",
    code: "jb-securities-vietnam",
    name: "JB Securities Vietnam"
  },
  { id: "aff-jb-capital-myanmar", code: "jb-capital-myanmar", name: "JB Capital Myanmar" },
  { id: "aff-jb-ppam", code: "jb-ppam", name: "JB PPAM" }
];

const affiliateIdsByName = new Map(
  affiliateSeeds.map((affiliate) => [affiliate.name, affiliate.id])
);

function inferContentType(fileName: string): string {
  if (fileName.endsWith(".png")) {
    return "image/png";
  }

  if (fileName.endsWith(".pdf")) {
    return "application/pdf";
  }

  if (fileName.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }

  return "application/octet-stream";
}

function plannedDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

async function seedReviewCase(reviewCase: ReviewCase) {
  const affiliateId = affiliateIdsByName.get(reviewCase.affiliate) ?? "aff-jeonbuk-bank";

  await prisma.reviewCase.upsert({
    where: { id: reviewCase.id },
    update: {
      title: reviewCase.title,
      status: reviewCase.status,
      highestRiskLevel: reviewCase.highestRiskLevel,
      requestDepartment: reviewCase.requestDepartment ?? ""
    },
    create: {
      id: reviewCase.id,
      tenantId: "tenant-demo",
      affiliateId,
      affiliateName: reviewCase.affiliate,
      title: reviewCase.title,
      productType: reviewCase.productType,
      channelType: reviewCase.channelType,
      plannedPublishDate: plannedDate(reviewCase.plannedPublishDate),
      status: reviewCase.status,
      highestRiskLevel: reviewCase.highestRiskLevel,
      requesterId: "user-requester-demo",
      reviewerId: "user-reviewer-demo",
      requesterName: reviewCase.requester,
      requestDepartment: reviewCase.requestDepartment ?? "",
      reviewerName: reviewCase.reviewer,
      promotionalCopy: reviewCase.promotionalCopy,
      disclosure: reviewCase.disclosure,
      productDescription: reviewCase.productDescription,
      missingMaterials: reviewCase.missingMaterials,
      expectedDraft: reviewCase.expectedDraft,
      currentDraft: reviewCase.currentDraft,
      currentDraftVersion: reviewCase.currentDraftVersion ?? 0,
      analysisNotice: reviewCase.analysisNotice,
      files: {
        create: reviewCase.files.map((file) => ({
          id: file.id,
          originalFilename: file.name,
          fileType: file.fileType,
          classificationConfidence: file.classificationConfidence,
          parseStatus: file.parseStatus,
          storageProvider: file.storageProvider ?? "sample",
          storageKey: file.storageKey ?? `sample/${reviewCase.id}/${file.name}`,
          contentType: file.contentType ?? inferContentType(file.name),
          sizeBytes: BigInt(file.sizeBytes ?? file.name.length * 1024)
        }))
      },
      issues: {
        create: reviewCase.issues.map((issue) => ({
          id: issue.id,
          issueType: issue.issueType,
          riskLevel: issue.riskLevel,
          reviewerRiskLevel: issue.reviewerRiskLevel,
          title: issue.title,
          targetText: issue.targetText,
          targetBbox: issue.targetBbox,
          sourceAgents: issue.sourceAgents,
          suggestedAction: issue.suggestedAction,
          finalAction: issue.finalAction,
          reviewerComment: issue.reviewerComment,
          status: issue.status,
          description: issue.description,
          suggestedCopy: issue.suggestedCopy,
          evidence: {
            create: issue.evidence.map((evidence) => ({
              id: evidence.id,
              sourceType: evidence.sourceType,
              title: evidence.title,
              page: evidence.page,
              section: evidence.section,
              quoteSummary: evidence.quoteSummary,
              relevanceScore: evidence.relevanceScore
            }))
          }
        }))
      }
    }
  });
}

async function main() {
  await prisma.tenant.upsert({
    where: { id: "tenant-demo" },
    update: { name: "FinProof Demo Tenant" },
    create: { id: "tenant-demo", name: "FinProof Demo Tenant" }
  });

  for (const affiliate of affiliateSeeds) {
    await prisma.affiliate.upsert({
      where: { tenantId_code: { tenantId: "tenant-demo", code: affiliate.code } },
      update: { name: affiliate.name },
      create: {
        id: affiliate.id,
        tenantId: "tenant-demo",
        code: affiliate.code,
        name: affiliate.name
      }
    });
  }

  await prisma.user.upsert({
    where: { id: "user-requester-demo" },
    update: { role: "requester", status: "active" },
    create: {
      id: "user-requester-demo",
      tenantId: "tenant-demo",
      email: "requester.demo@finproof.local",
      name: "업로드 요청자",
      role: "requester"
    }
  });

  await prisma.user.upsert({
    where: { id: "user-reviewer-demo" },
    update: { role: "reviewer", status: "active" },
    create: {
      id: "user-reviewer-demo",
      tenantId: "tenant-demo",
      email: "reviewer.demo@finproof.local",
      name: "준법심의자 박민준",
      role: "reviewer"
    }
  });

  await prisma.user.upsert({
    where: { id: "user-admin-demo" },
    update: { role: "compliance_admin", status: "active" },
    create: {
      id: "user-admin-demo",
      tenantId: "tenant-demo",
      email: "admin.demo@finproof.local",
      name: "컴플라이언스 관리자",
      role: "compliance_admin"
    }
  });

  for (const reviewCase of cases) {
    await seedReviewCase(reviewCase);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
