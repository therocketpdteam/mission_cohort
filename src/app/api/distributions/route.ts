import { handleApiError, ok } from "@/lib/api";
import { isMissingPrismaSchema, migrationRequiredResult } from "@/lib/prismaCompatibility";
import { createDistributionPayout, getCohortDistribution, updateCohortDistribution } from "@/services/distributionService";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const cohortId = searchParams.get("cohortId");

    if (!cohortId) {
      throw Object.assign(new Error("cohortId is required."), { code: "BAD_REQUEST", status: 400 });
    }

    return ok(await getCohortDistribution(cohortId));
  } catch (error) {
    if (isMissingPrismaSchema(error)) {
      return ok(migrationRequiredResult("Distribution ledger"));
    }
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    return ok(await updateCohortDistribution(await request.json()));
  } catch (error) {
    if (isMissingPrismaSchema(error)) {
      return ok(migrationRequiredResult("Distribution ledger"), { status: 409 });
    }
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return ok(await createDistributionPayout(await request.json()), { status: 201 });
  } catch (error) {
    if (isMissingPrismaSchema(error)) {
      return ok(migrationRequiredResult("Distribution ledger"), { status: 409 });
    }
    return handleApiError(error);
  }
}
