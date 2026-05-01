import { fail, handleApiError, ok } from "@/lib/api";
import { createReportShareLink, getCohortReport, listReportShareLinks, revokeReportShareLink } from "@/services/reportService";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const cohortId = url.searchParams.get("cohortId") ?? undefined;
    const includeLinks = url.searchParams.get("includeLinks") === "true";
    return ok({
      reports: await getCohortReport(cohortId),
      links: includeLinks ? await listReportShareLinks() : []
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    return ok(await createReportShareLink({
      cohortId: body.cohortId,
      title: body.title,
      reportType: body.reportType,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
      createdById: body.createdById
    }), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();

    if (!body.id || body.action !== "revoke") {
      return fail("id and revoke action are required", "BAD_REQUEST", 400);
    }

    return ok(await revokeReportShareLink(body.id));
  } catch (error) {
    return handleApiError(error);
  }
}
