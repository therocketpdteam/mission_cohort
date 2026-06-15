import { fail, handleApiError, ok } from "@/lib/api";
import {
  createReportShareLink,
  getCohortRegistrationReport,
  getCohortRegistrationReportOptions,
  getCohortReport,
  listReportShareLinks,
  revokeReportShareLink
} from "@/services/reportService";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const cohortId = url.searchParams.get("cohortId") ?? undefined;
    const includeLinks = url.searchParams.get("includeLinks") === "true";

    if (url.searchParams.get("reportType") === "cohort_registration_options") {
      if (!cohortId) {
        return fail("cohortId is required for cohort registration report options", "BAD_REQUEST", 400);
      }

      return ok(await getCohortRegistrationReportOptions(cohortId));
    }

    if (url.searchParams.get("reportType") === "cohort_registration") {
      if (!cohortId) {
        return fail("cohortId is required for cohort registration reports", "BAD_REQUEST", 400);
      }

      return ok(await getCohortRegistrationReport({
        cohortId,
        audience: url.searchParams.get("audience") === "internal" ? "internal" : "thought_leader",
        registrationStatus: url.searchParams.get("registrationStatus") ?? undefined,
        paymentStatus: url.searchParams.get("paymentStatus") ?? undefined,
        rosterStatus: url.searchParams.get("rosterStatus") ?? undefined,
        cityState: url.searchParams.get("cityState") ?? undefined,
        state: url.searchParams.get("state") ?? undefined,
        zip: url.searchParams.get("zip") ?? undefined,
        dateFrom: url.searchParams.get("dateFrom") ?? undefined,
        dateTo: url.searchParams.get("dateTo") ?? undefined,
        source: url.searchParams.get("source") ?? undefined,
        includeArchived: url.searchParams.get("includeArchived") === "1",
        columns: (url.searchParams.get("columns") ?? "").split(",").map((column) => column.trim()).filter(Boolean)
      }));
    }

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
