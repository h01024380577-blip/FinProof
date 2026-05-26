import assert from "node:assert/strict";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL or TEST_DATABASE_URL is required for Prisma API smoke");
}

process.env.DATABASE_URL = databaseUrl;
process.env.FINPROOF_REVIEW_STORE = "prisma";

const [
  { resetDefaultReviewStoreForTests },
  { GET: listReviewCases, POST: createReviewCase },
  { POST: startAnalysis },
  { GET: getAnalysisStatus },
  { GET: listAuditEvents }
] = await Promise.all([
  import("../src/server/reviews"),
  import("../src/app/api/v1/review-cases/route"),
  import("../src/app/api/v1/review-cases/[caseId]/analysis/start/route"),
  import("../src/app/api/v1/review-cases/[caseId]/analysis/status/route"),
  import("../src/app/api/v1/review-cases/[caseId]/audit-events/route")
]);

function jsonRequest(path: string, body: unknown, method = "POST", role = "reviewer") {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-finproof-role": role
    },
    body: JSON.stringify(body)
  });
}

function roleRequest(path: string, role: string, method = "GET") {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "x-finproof-role": role }
  });
}

function params<T extends Record<string, string>>(value: T) {
  return { params: Promise.resolve(value) };
}

async function readJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

resetDefaultReviewStoreForTests();

const createResponse = await createReviewCase(
  jsonRequest("/api/v1/review-cases", { samplePackageId: "rc-demo-deposit-001" })
);
assert.equal(createResponse.status, 201);

const requesterListResponse = await listReviewCases(
  roleRequest("/api/v1/review-cases", "requester")
);
assert.equal(requesterListResponse.status, 200);
const requesterListBody = await readJson(requesterListResponse);
const requesterCase = (requesterListBody.reviewCases as Array<Record<string, unknown>>).find(
  (reviewCase) => reviewCase.id === "rc-demo-deposit-001"
);
assert.deepEqual(requesterCase?.availableActions, []);

const reviewerListResponse = await listReviewCases(roleRequest("/api/v1/review-cases", "reviewer"));
assert.equal(reviewerListResponse.status, 200);
const reviewerListBody = await readJson(reviewerListResponse);
const reviewerCase = (reviewerListBody.reviewCases as Array<Record<string, unknown>>).find(
  (reviewCase) => reviewCase.id === "rc-demo-deposit-001"
);
assert.deepEqual(reviewerCase?.availableActions, ["start_analysis"]);

const waitingStatusResponse = await getAnalysisStatus(
  roleRequest("/api/v1/review-cases/rc-demo-deposit-001/analysis/status", "reviewer"),
  params({ caseId: "rc-demo-deposit-001" })
);
assert.equal(waitingStatusResponse.status, 200);
const waitingStatusBody = await readJson(waitingStatusResponse);
assert.equal(waitingStatusBody.status, "not_started");

const analysisResponse = await startAnalysis(
  jsonRequest("/api/v1/review-cases/rc-demo-deposit-001/analysis/start", {}),
  params({ caseId: "rc-demo-deposit-001" })
);
assert.equal(analysisResponse.status, 200);
const analysisBody = await readJson(analysisResponse);
assert.equal(analysisBody.status, "analysis_complete");
assert.equal(typeof analysisBody.jobId, "string");

const completedStatusResponse = await getAnalysisStatus(
  roleRequest("/api/v1/review-cases/rc-demo-deposit-001/analysis/status", "reviewer"),
  params({ caseId: "rc-demo-deposit-001" })
);
assert.equal(completedStatusResponse.status, 200);
const completedStatusBody = await readJson(completedStatusResponse);
assert.equal(completedStatusBody.status, "completed");
assert.equal(completedStatusBody.progress, 100);

const auditResponse = await listAuditEvents(
  roleRequest("/api/v1/review-cases/rc-demo-deposit-001/audit-events", "reviewer"),
  params({ caseId: "rc-demo-deposit-001" })
);
assert.equal(auditResponse.status, 200);
const auditBody = await readJson(auditResponse);
const auditEvents = auditBody.auditEvents as Array<Record<string, unknown>>;
assert.ok(auditEvents.some((event) => event.action === "analysis.start"));

console.log(
  JSON.stringify(
    {
      ok: true,
      reviewCaseId: "rc-demo-deposit-001",
      jobId: analysisBody.jobId,
      auditEvents: auditEvents.length
    },
    null,
    2
  )
);
