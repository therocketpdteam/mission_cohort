import { z } from "zod";

export const registrationDocumentSchema = z.object({
  type: z.enum(["purchaseOrder", "checkPayment"]),
  fileKey: z.string().min(1).max(1024).nullish(),
  fileName: z.string().max(255).nullish(),
  contentType: z.string().max(255).nullish(),
  purchaseOrderNumber: z.string().max(255).nullish(),
  checkAmount: z.coerce.number().finite().positive("Enter a check amount greater than zero.").max(99999999.99).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001, "Use no more than two decimal places.").optional(),
  checkNumber: z.string().trim().min(1, "Enter the check number.").max(100).regex(/^[^\r\n]+$/, "Check number must be on one line.").optional(),
  checkPaymentRecordId: z.string().min(1).optional()
}).superRefine((value, context) => {
  if (value.fileKey && !value.fileKey.startsWith(value.type === "purchaseOrder" ? "purchase-order/" : "check-payment/")) {
    context.addIssue({ code: "custom", path: ["fileKey"], message: "Registration document does not match its upload type." });
  }
  if (value.type === "checkPayment" && value.fileKey) {
    if (value.checkAmount === undefined) context.addIssue({ code: "custom", path: ["checkAmount"], message: "Enter the check amount." });
    if (!value.checkNumber) context.addIssue({ code: "custom", path: ["checkNumber"], message: "Enter the check number." });
  }
});
