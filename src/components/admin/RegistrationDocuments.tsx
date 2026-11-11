"use client";

import { ArticleOutlined, DeleteOutline, VisibilityOutlined } from "@/components/ui/icons";
import { Button, Stack, TextField } from "@/components/ui/primitives";
import { adminApi, uploadAdminFile } from "@/lib/adminApi";
import { checkReconciliationPreview, readCheckPaymentProof } from "@/lib/checkPayment";
import { formatCurrency as money } from "@/lib/formatting";
import { registrationDocumentSchema } from "@/validators/registrationDocument";
import { useEffect, useState } from "react";
import type { AdminRow } from "./common";
import { CollapsibleSectionCard } from "./CollapsibleSectionCard";
import { registrationFinanceAlerts } from "@/lib/registrationFinanceAlerts";

type DocumentType = "purchaseOrder" | "checkPayment";

export function RegistrationDocuments({ registration, onChanged, onError }: {
  registration: AdminRow;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [working, setWorking] = useState<DocumentType | "">("");
  const [saved, setSaved] = useState(registration);
  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState(String(registration.purchaseOrderNumber ?? ""));
  const [checkAmount, setCheckAmount] = useState("");
  const [checkNumber, setCheckNumber] = useState("");
  const [checkPaymentRecordId, setCheckPaymentRecordId] = useState<string | undefined>();
  const [notice, setNotice] = useState("");
  const [validationError, setValidationError] = useState("");

  function selectCheck(row?: AdminRow) {
    setCheckPaymentRecordId(row?.id);
    setCheckAmount(row ? String(row.amount) : "");
    setCheckNumber(readCheckPaymentProof(row?.notes)?.checkNumber ?? "");
    setValidationError("");
    setNotice("");
  }

  useEffect(() => {
    setSaved(registration);
    setPurchaseOrderNumber(String(registration.purchaseOrderNumber ?? ""));
    const recordedChecks = (registration.paymentRecords ?? []).filter((row: AdminRow) => row.method === "CHECK" && !["REFUNDED", "CANCELLED"].includes(row.status));
    const current = recordedChecks.find((row: AdminRow) => readCheckPaymentProof(row.notes)?.fileKey === registration.checkPaymentFileKey)
      ?? (recordedChecks.length === 1 && !readCheckPaymentProof(recordedChecks[0].notes) ? recordedChecks[0] : undefined);
    setCheckPaymentRecordId(current?.id);
    setCheckAmount(current ? String(current.amount) : "");
    setCheckNumber(readCheckPaymentProof(current?.notes)?.checkNumber ?? "");
  }, [registration]);

  async function upload(type: DocumentType, file?: File) {
    if (!file || working) return;
    setValidationError("");
    setNotice("");
    const metadata = {
      type,
      fileKey: `${type === "purchaseOrder" ? "purchase-order" : "check-payment"}/validation`,
      fileName: file.name,
      contentType: file.type,
      purchaseOrderNumber: type === "purchaseOrder" ? purchaseOrderNumber.trim() || null : undefined,
      checkAmount: type === "checkPayment" ? checkAmount : undefined,
      checkNumber: type === "checkPayment" ? checkNumber : undefined,
      checkPaymentRecordId: type === "checkPayment" ? checkPaymentRecordId : undefined
    };
    const validation = registrationDocumentSchema.safeParse(metadata);
    if (!validation.success) {
      setValidationError(validation.error.issues.map(issue => issue.message).join(" "));
      return;
    }
    setWorking(type);
    try {
      const result = await uploadAdminFile<{ fileKey: string }>(file, type === "purchaseOrder" ? "purchase-order" : "check-payment");
      const updated = await adminApi<AdminRow>("/api/registrations", {
        method: "PATCH",
        body: { id: saved.id, action: "updateDocument", ...validation.data, fileKey: result.fileKey }
      });
      setSaved(updated);
      if (type === "checkPayment") {
        const current = (updated.paymentRecords ?? []).find((row: AdminRow) => readCheckPaymentProof(row.notes)?.fileKey === result.fileKey);
        selectCheck(current);
        setNotice(`Check #${checkNumber.trim()} saved. ${updated.paymentStatus === "PAID" ? "Registration fully paid." : "Registration partially paid."}`);
      }
      try { await onChanged(); } catch { setNotice("Saved. Refresh the registration to see the latest details."); }
    } catch (error) {
      setValidationError((error as Error).message);
      onError((error as Error).message);
    } finally { setWorking(""); }
  }

  async function remove(type: DocumentType) {
    setValidationError("");
    setWorking(type);
    try {
      const updated = await adminApi<AdminRow>("/api/registrations", {
        method: "PATCH", body: { id: saved.id, action: "updateDocument", type, fileKey: null, fileName: null, contentType: null }
      });
      setSaved({ ...saved, ...updated });
      if (type === "checkPayment") selectCheck();
      setNotice(type === "checkPayment" ? "Proof removed. The recorded payment is unchanged." : "Purchase order document removed.");
      try { await onChanged(); } catch { setNotice("Saved. Refresh the registration to see the latest details."); }
    } catch (error) { onError((error as Error).message); }
    finally { setWorking(""); }
  }

  const checks: AdminRow[] = (saved.paymentRecords ?? []).filter((row: AdminRow) => row.method === "CHECK" && !["REFUNDED", "CANCELLED"].includes(row.status));
  const selectedCheck = checks.find(row => row.id === checkPaymentRecordId);
  const selectedProof = readCheckPaymentProof(selectedCheck?.notes);
  const preview = Number(checkAmount) > 0 ? checkReconciliationPreview(saved.totalAmount, saved.paymentRecords ?? [], checkAmount, checkPaymentRecordId) : null;
  const documents = [
    { type: "purchaseOrder" as const, label: "Purchase order", fileKey: saved.purchaseOrderFileKey, fileName: saved.purchaseOrderFileName },
    { type: "checkPayment" as const, label: "Check payment proof", fileKey: selectedProof?.fileKey ?? saved.checkPaymentFileKey, fileName: selectedProof?.fileName ?? saved.checkPaymentFileName }
  ];

  return (
    <CollapsibleSectionCard title="Payment Documents" compact alertCount={registrationFinanceAlerts(saved).documents}>
      <div className="registration-payment-documents">
        <Stack spacing={1.25}>
          {documents.map(document => (
            <div key={document.type} className={`registration-payment-document ${document.type === "purchaseOrder" ? "is-po" : "is-check"}`}>
              <div className="registration-payment-document-heading">
                <ArticleOutlined />
                <div><strong>{document.label}</strong><span>{document.fileName || "No document uploaded"}</span></div>
              </div>
              {document.type === "purchaseOrder" ? (
                <TextField size="small" label="PO number" value={purchaseOrderNumber} onChange={event => setPurchaseOrderNumber(event.target.value)} disabled={Boolean(working)} />
              ) : (
                <>
                  <TextField size="small" label="Check amount ($)" type="number" min="0.01" step="0.01" value={checkAmount} onChange={event => setCheckAmount(event.target.value)} disabled={Boolean(working)} />
                  <TextField size="small" label="Check number" value={checkNumber} maxLength={100} onChange={event => setCheckNumber(event.target.value)} disabled={Boolean(working)} />
                </>
              )}
              <div className="registration-payment-document-upload">
                <Button component="label" size="small" variant="outlined" disabled={Boolean(working)}>
                  {working === document.type ? "Uploading…" : document.type === "checkPayment" ? selectedCheck ? "Replace & update" : "Upload & record" : document.fileKey ? "Replace" : "Upload"}
                  <input aria-label={`Upload ${document.label.toLowerCase()}`} disabled={Boolean(working)} hidden type="file" accept="application/pdf,image/*" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void upload(document.type, file); }} />
                </Button>
              </div>
              <div className="registration-payment-document-note">
                {document.type === "purchaseOrder" ? "Upload stages the number for Apply Changes." : preview ? `${preview.status === "PAID" ? "Fully paid" : "Partially paid"} after upload · ${money(preview.collected)} received · ${money(preview.balance)} remaining. Based on the amount you enter; the file is not scanned.` : "Enter the check amount and number, then upload the proof to record payment. The file is not scanned."}
              </div>
              {document.fileKey && (
                <div className="registration-payment-document-links">
                  <Button size="small" variant="outlined" startIcon={<VisibilityOutlined />} href={`/api/registration-documents?registrationId=${encodeURIComponent(saved.id)}&type=${document.type}${document.type === "checkPayment" && selectedCheck ? `&paymentRecordId=${encodeURIComponent(selectedCheck.id)}` : ""}`} target="_blank" rel="noreferrer">View</Button>
                  {(!selectedCheck || document.fileKey === saved.checkPaymentFileKey || document.type === "purchaseOrder") && <Button size="small" variant="text" color="warning" startIcon={<DeleteOutline />} disabled={Boolean(working)} onClick={() => void remove(document.type)}>Remove proof</Button>}
                  {document.type === "checkPayment" && selectedCheck && <Button size="small" variant="text" disabled={Boolean(working)} onClick={() => selectCheck()}>Record another check</Button>}
                </div>
              )}
              {document.type === "checkPayment" && checks.length > 0 && <div className="registration-payment-document-links" aria-label="Recorded checks">{checks.map(row => <Button key={row.id} size="small" variant="text" disabled={Boolean(working)} onClick={() => selectCheck(row)}>{readCheckPaymentProof(row.notes) ? `Check #${readCheckPaymentProof(row.notes)!.checkNumber}` : "Recorded check"} · {money(Number(row.amount))}</Button>)}{!document.fileKey && selectedCheck && <Button size="small" variant="text" disabled={Boolean(working)} onClick={() => selectCheck()}>Record another check</Button>}</div>}
            </div>
          ))}
          {validationError && <div role="alert" className="registration-payment-error">{validationError}</div>}
          {notice && <div role="status">{notice}</div>}
        </Stack>
      </div>
    </CollapsibleSectionCard>
  );
}
