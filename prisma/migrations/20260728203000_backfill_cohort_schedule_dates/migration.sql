UPDATE "Cohort" AS cohort
SET
  "startDate" = schedule."firstStart",
  "endDate" = schedule."lastEnd"
FROM (
  SELECT
    "cohortId",
    MIN("startTime") AS "firstStart",
    MAX("endTime") AS "lastEnd"
  FROM "CohortSession"
  GROUP BY "cohortId"
) AS schedule
WHERE cohort."id" = schedule."cohortId"
  AND (
    cohort."startDate" IS DISTINCT FROM schedule."firstStart"
    OR cohort."endDate" IS DISTINCT FROM schedule."lastEnd"
  );
