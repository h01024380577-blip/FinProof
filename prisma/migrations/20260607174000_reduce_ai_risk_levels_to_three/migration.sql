UPDATE "review_cases"
SET "highest_risk_level" = 'high'
WHERE "highest_risk_level" = 'reject_recommended';

UPDATE "review_issues"
SET "risk_level" = 'high'
WHERE "risk_level" = 'reject_recommended';

UPDATE "review_issues"
SET "reviewer_risk_level" = 'high'
WHERE "reviewer_risk_level" = 'reject_recommended';

UPDATE "agent_findings"
SET "risk_level" = 'high'
WHERE "risk_level" = 'reject_recommended';

ALTER TYPE "RiskLevel" RENAME TO "RiskLevel_old";
CREATE TYPE "RiskLevel" AS ENUM ('info', 'caution', 'high');

ALTER TABLE "review_cases"
  ALTER COLUMN "highest_risk_level" DROP DEFAULT,
  ALTER COLUMN "highest_risk_level" TYPE "RiskLevel"
    USING "highest_risk_level"::text::"RiskLevel",
  ALTER COLUMN "highest_risk_level" SET DEFAULT 'info';

ALTER TABLE "review_issues"
  ALTER COLUMN "risk_level" TYPE "RiskLevel"
    USING "risk_level"::text::"RiskLevel",
  ALTER COLUMN "reviewer_risk_level" TYPE "RiskLevel"
    USING "reviewer_risk_level"::text::"RiskLevel";

ALTER TABLE "agent_findings"
  ALTER COLUMN "risk_level" TYPE "RiskLevel"
    USING "risk_level"::text::"RiskLevel";

DROP TYPE "RiskLevel_old";
