import { DistributionPayoutStatus, PaymentStatus, RegistrationStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { dateInput, moneyInput } from "@/lib/validators";

export const distributionUpdateSchema = z.object({
  cohortId: z.string().min(1),
  commissionPercent: z.coerce.number().min(0).max(100).default(30),
  tlName: z.string().optional(),
  tlSharePercent: z.coerce.number().min(0).max(100).optional(),
  quickBooksVendorRef: z.string().optional(),
  quickBooksExpenseAccountRef: z.string().optional(),
  notes: z.string().optional()
});

export const distributionPayoutCreateSchema = z.object({
  cohortId: z.string().min(1),
  paymentRecordId: z.string().optional(),
  amount: moneyInput,
  status: z.nativeEnum(DistributionPayoutStatus).default(DistributionPayoutStatus.PLANNED),
  paymentDate: dateInput.optional(),
  attachmentFileKey: z.string().optional(),
  attachmentUrl: z.string().optional(),
  notes: z.string().optional()
});

export const distributionPayoutUpdateSchema = distributionPayoutCreateSchema.partial().extend({
  id: z.string().min(1)
});

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function percent(value: unknown) {
  return Number(value ?? 0) / 100;
}

const excludedRevenuePaymentStatuses = new Set<PaymentStatus>([
  PaymentStatus.CANCELLED,
  PaymentStatus.REFUNDED
]);

export async function getCohortDistribution(cohortId: string) {
  const [cohort, payments, registrations] = await Promise.all([
    prisma.cohort.findUnique({ where: { id: cohortId }, include: { presenter: true, distribution: true } }),
    prisma.paymentRecord.findMany({ where: { cohortId, registration: { archivedAt: null } } }),
    prisma.registration.findMany({ where: { cohortId, archivedAt: null } })
  ]);

  if (!cohort) {
    throw Object.assign(new Error("Cohort not found."), { code: "NOT_FOUND", status: 404 });
  }

  const distribution = await prisma.cohortDistribution.upsert({
    where: { cohortId },
    update: cohort.distribution && (!cohort.distribution.quickBooksVendorRef || !cohort.distribution.quickBooksExpenseAccountRef)
      ? {
        quickBooksVendorRef: cohort.distribution.quickBooksVendorRef ?? cohort.presenter.quickBooksVendorRef,
        quickBooksExpenseAccountRef: cohort.distribution.quickBooksExpenseAccountRef ?? cohort.presenter.quickBooksExpenseAccountRef
      }
      : {},
    create: {
      cohortId,
      commissionPercent: 30,
      tlSharePercent: 70,
      tlName: [cohort.presenter.firstName, cohort.presenter.lastName].filter(Boolean).join(" ") || undefined,
      quickBooksVendorRef: cohort.presenter.quickBooksVendorRef,
      quickBooksExpenseAccountRef: cohort.presenter.quickBooksExpenseAccountRef
    },
    include: { payouts: { orderBy: { createdAt: "desc" }, include: { paymentRecord: true } } }
  });

  const billableRegistrations = registrations.filter((registration) => (
    registration.status !== RegistrationStatus.CANCELLED &&
    !excludedRevenuePaymentStatuses.has(registration.paymentStatus)
  ));
  const soldAmount = billableRegistrations.reduce((sum, registration) => sum + Number(registration.totalAmount ?? 0), 0);
  const paidAmount = payments
    .filter((payment) => payment.status === PaymentStatus.PAID || payment.status === PaymentStatus.PARTIALLY_PAID)
    .reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0);
  const payoutMade = distribution.payouts
    .filter((payout) => payout.status === DistributionPayoutStatus.PAID || payout.status === DistributionPayoutStatus.PARTIAL)
    .reduce((sum, payout) => sum + Number(payout.amount ?? 0), 0);
  const commissionAmount = roundMoney(soldAmount * percent(distribution.commissionPercent));
  const tlShareAmount = roundMoney(soldAmount * percent(distribution.tlSharePercent));
  const paymentRatio = soldAmount > 0 ? paidAmount / soldAmount : 0;
  const tlPayoutDue = roundMoney(tlShareAmount * paymentRatio);
  const pendingPayout = roundMoney(Math.max(tlPayoutDue - payoutMade, 0));
  const projectReturn = roundMoney(paidAmount - payoutMade);

  return {
    cohort,
    distribution,
    totals: {
      soldAmount,
      paidAmount,
      commissionAmount,
      tlShareAmount,
      paymentRatio,
      tlPayoutDue,
      payoutMade,
      pendingPayout,
      projectReturn,
      returnPercent: paidAmount > 0 ? roundMoney((projectReturn / paidAmount) * 100) : 0
    }
  };
}

export async function updateCohortDistribution(input: z.input<typeof distributionUpdateSchema>) {
  const data = distributionUpdateSchema.parse(input);
  return prisma.cohortDistribution.upsert({
    where: { cohortId: data.cohortId },
    create: {
      cohortId: data.cohortId,
      commissionPercent: data.commissionPercent,
      tlSharePercent: data.tlSharePercent ?? 100 - data.commissionPercent,
      tlName: data.tlName,
      quickBooksVendorRef: data.quickBooksVendorRef,
      quickBooksExpenseAccountRef: data.quickBooksExpenseAccountRef,
      notes: data.notes
    },
    update: {
      commissionPercent: data.commissionPercent,
      tlSharePercent: data.tlSharePercent ?? 100 - data.commissionPercent,
      tlName: data.tlName,
      quickBooksVendorRef: data.quickBooksVendorRef,
      quickBooksExpenseAccountRef: data.quickBooksExpenseAccountRef,
      notes: data.notes
    }
  });
}

export async function createDistributionPayout(input: z.input<typeof distributionPayoutCreateSchema>) {
  const data = distributionPayoutCreateSchema.parse(input);
  const distribution = await prisma.cohortDistribution.upsert({
    where: { cohortId: data.cohortId },
    update: {},
    create: { cohortId: data.cohortId, commissionPercent: 30, tlSharePercent: 70 }
  });

  return prisma.distributionPayout.create({
    data: {
      distributionId: distribution.id,
      paymentRecordId: data.paymentRecordId,
      amount: data.amount,
      status: data.status,
      paymentDate: data.paymentDate,
      attachmentFileKey: data.attachmentFileKey,
      attachmentUrl: data.attachmentUrl,
      notes: data.notes
    }
  });
}

export async function updateDistributionPayout(input: z.input<typeof distributionPayoutUpdateSchema>) {
  const data = distributionPayoutUpdateSchema.parse(input);
  return prisma.distributionPayout.update({
    where: { id: data.id },
    data: {
      paymentRecordId: data.paymentRecordId,
      amount: data.amount,
      status: data.status,
      paymentDate: data.paymentDate,
      attachmentFileKey: data.attachmentFileKey,
      attachmentUrl: data.attachmentUrl,
      notes: data.notes
    }
  });
}

export async function cancelDistributionPayout(id: string) {
  return prisma.distributionPayout.update({
    where: { id },
    data: { status: DistributionPayoutStatus.CANCELLED }
  });
}
