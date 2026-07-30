import { prisma } from "@/lib/prisma";

const SEARCH_LIMIT = 12;

function cleanQuery(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function decimalNumber(value: unknown) {
  if (value == null) {
    return 0;
  }

  return Number(value);
}

function containsQuery(query: string) {
  return { contains: query, mode: "insensitive" as const };
}

function includesQuery(value: string | null | undefined, query: string) {
  return String(value ?? "").toLowerCase().includes(query.toLowerCase());
}

type RegistrationSearchMatch = {
  primaryContactEmail: string;
  primaryContactName: string;
  billingContactEmail?: string | null;
  billingContactName?: string | null;
  invoiceNumber?: string | null;
  purchaseOrderNumber?: string | null;
  organization: { name: string };
  participants: Array<{ email: string; firstName: string; lastName: string }>;
  invoiceDrafts: Array<{ invoiceNumber?: string | null; purchaseOrderNumber?: string | null }>;
};

function matchTypesForRegistration(registration: RegistrationSearchMatch, query: string) {
  const matches = new Set<string>();

  if (includesQuery(registration.primaryContactEmail, query) || includesQuery(registration.primaryContactName, query)) {
    matches.add("POC");
  }

  if (includesQuery(registration.billingContactEmail, query) || includesQuery(registration.billingContactName, query)) {
    matches.add("Billing");
  }

  if (registration.participants.some((participant) => (
    includesQuery(participant.email, query) ||
    includesQuery(participant.firstName, query) ||
    includesQuery(participant.lastName, query)
  ))) {
    matches.add("Participant");
  }

  if (includesQuery(registration.organization.name, query)) {
    matches.add("Organization");
  }

  if (
    includesQuery(registration.invoiceNumber, query) ||
    includesQuery(registration.purchaseOrderNumber, query) ||
    registration.invoiceDrafts.some((invoice) => includesQuery(invoice.invoiceNumber, query) || includesQuery(invoice.purchaseOrderNumber, query))
  ) {
    matches.add("Invoice/PO");
  }

  return Array.from(matches);
}

export async function searchPeople(input: { query?: string | null; limit?: number }) {
  const query = cleanQuery(input.query);
  const requestedLimit = Number(input.limit ?? SEARCH_LIMIT);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 25)
    : SEARCH_LIMIT;

  if (query.length < 2) {
    return { query, results: [] };
  }

  const registrations = await prisma.registration.findMany({
    where: {
      OR: [
        { primaryContactEmail: containsQuery(query) },
        { primaryContactName: containsQuery(query) },
        { billingContactEmail: containsQuery(query) },
        { billingContactName: containsQuery(query) },
        { invoiceNumber: containsQuery(query) },
        { purchaseOrderNumber: containsQuery(query) },
        { externalSubmissionId: containsQuery(query) },
        { organization: { name: containsQuery(query) } },
        { cohort: { title: containsQuery(query) } },
        { cohort: { shortName: containsQuery(query) } },
        {
          participants: {
            some: {
              OR: [
                { email: containsQuery(query) },
                { firstName: containsQuery(query) },
                { lastName: containsQuery(query) },
                { title: containsQuery(query) }
              ]
            }
          }
        },
        {
          invoiceDrafts: {
            some: {
              OR: [
                { invoiceNumber: containsQuery(query) },
                { purchaseOrderNumber: containsQuery(query) }
              ]
            }
          }
        }
      ]
    },
    include: {
      cohort: {
        select: {
          id: true,
          title: true,
          shortName: true,
          slug: true,
          status: true,
          startDate: true
        }
      },
      organization: {
        select: {
          id: true,
          name: true,
          type: true
        }
      },
      participants: {
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          title: true,
          status: true,
          cohortId: true
        }
      },
      invoiceDrafts: {
        orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
        take: 4,
        select: {
          id: true,
          invoiceNumber: true,
          purchaseOrderNumber: true,
          issueDate: true,
          status: true,
          totalAmount: true,
          paidAmount: true,
          quickBooksInvoiceRef: true,
          quickBooksInvoiceStatus: true,
          quickBooksSyncStatus: true
        }
      },
      paymentRecords: {
        orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
        take: 4,
        select: {
          id: true,
          amount: true,
          status: true,
          method: true,
          invoiceNumber: true,
          paymentDate: true,
          quickBooksPaymentRef: true,
          quickBooksInvoiceRef: true
        }
      }
    },
    orderBy: [{ updatedAt: "desc" }],
    take: limit
  });

  const results = registrations.map((registration) => {
    const result = {
      id: registration.id,
      status: registration.status,
      paymentStatus: registration.paymentStatus,
      paymentMethod: registration.paymentMethod,
      participantListStatus: registration.participantListStatus,
      participantCount: registration.participantCount,
      savedParticipantCount: registration.participants.length,
      totalAmount: decimalNumber(registration.totalAmount),
      invoiceNumber: registration.invoiceNumber,
      purchaseOrderNumber: registration.purchaseOrderNumber,
      primaryContactName: registration.primaryContactName,
      primaryContactEmail: registration.primaryContactEmail,
      primaryContactTitle: registration.primaryContactTitle,
      billingContactName: registration.billingContactName,
      billingContactEmail: registration.billingContactEmail,
      archivedAt: registration.archivedAt,
      createdAt: registration.createdAt,
      updatedAt: registration.updatedAt,
      cohort: registration.cohort,
      organization: registration.organization,
      participants: registration.participants,
      invoiceDrafts: registration.invoiceDrafts.map((invoice) => ({
        ...invoice,
        totalAmount: decimalNumber(invoice.totalAmount),
        paidAmount: decimalNumber(invoice.paidAmount)
      })),
      paymentRecords: registration.paymentRecords.map((payment) => ({
        ...payment,
        amount: decimalNumber(payment.amount)
      })),
      links: {
        registration: `/registrations?id=${registration.id}`,
        cohort: `/cohorts/${registration.cohortId}`,
        communications: `/communications?search=${encodeURIComponent(registration.primaryContactEmail)}`
      }
    };

    return {
      ...result,
      matchTypes: matchTypesForRegistration(result, query)
    };
  });

  return { query, results };
}
