# Check payment reconciliation

Payment Documents is shared by the registration drawer and cohort registration detail. Purchase orders keep their label, number, and upload control on a single row when panel width permits. The Apply Changes note remains below; PO number staging is unchanged. Narrow phone panels stack safely.

A check upload requires a positive amount in dollars (at most two decimals) and a check number. Leading zeros in the number are preserved. The amount is entered by the administrator; the uploaded image/PDF is not scanned. The client previews the resulting collected total and balance. Server validation is authoritative.

The upload records a CHECK PaymentRecord and sets the registration to PAID when recorded receipts cover the total, otherwise PARTIALLY_PAID. Other paid/partial receipts count toward the total; pending, invoiced, cancelled, and refunded records do not. The registration's original billing method (for example PO) is preserved. The general payment-status synchronizer now also compares collected amounts with a known registration total instead of treating any individual PAID receipt as full settlement.

Replacing a check uses its payment record ID and updates that receipt rather than adding another. A retry with the same normalized check number resolves to the same record. Record another check starts an additional receipt. Existing CHECK records can be selected to attach their proof without duplicating money already received. The latest proof opens by default; recorded-check buttons switch between earlier receipts. Removing the current proof does not reverse or delete a payment. Earlier proof files are retained as evidence and can be viewed from their payment history.

Receipt, proof reference, registration status, and audit entry are saved in one transaction, locking the registration row before reading the ledger. Stale/foreign payment IDs, check-number collisions, archived/cancelled/refunded registrations, and zero-value/comped registrations are rejected. Externally linked payment amounts cannot be changed here. Legacy invoice-only paid amounts and unmatched legacy paid flags require reconciliation in Payments first, to avoid silently counting the same receipt twice. Corrections that would contradict invoice paid amounts are also blocked.

No database migration is needed. A readable check-number line and versioned proof metadata are stored together in PaymentRecord.notes, preserving other notes. The file is still stored in private application storage. The authenticated document endpoint accepts an optional paymentRecordId, scoped to the registration and CHECK method, to read retained proofs. No public document URLs are created.

This path does not send receipts, emails, calendar updates, apply other staged registration changes, write to QuickBooks, or change invoice paid amounts. No existing records are backfilled on deployment. Payment corrections use the existing Payments workflow when they need broader reconciliation.

Validation: `pnpm qa:prepush` and `HISTORY_BROWSER_CHANNEL=chrome pnpm exec playwright test --config tests/ui/payment-documents.config.ts`. Browser fixtures mount the actual component and mock all upload/payment APIs. Unit tests isolate the ledger and forbid outbound HTTP; no production data is used.
