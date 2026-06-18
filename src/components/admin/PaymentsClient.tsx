"use client";

import { CheckCircleOutline } from "@/components/ui/icons";
import { Box, MenuItem, TextField } from "@/components/ui/primitives";
import { GridColDef } from "./common";
import { useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/adminApi";
import { formatProperDisplay, formatStatusLabel } from "@/lib/formatting";
import { AdminRow, AppDataGrid, CompactFilterBar, EmptyState, PageHeader, PageStack, RowActionMenu, SectionCard, StatusChip, TableShell, useNotifier } from "./common";

const paymentStatuses = ["PENDING", "INVOICED", "PARTIALLY_PAID", "PAID", "REFUNDED", "CANCELLED"];

export function PaymentsClient() {
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const { notifySuccess, notifyError, snackbar } = useNotifier();

  async function load() {
    setRows(await adminApi<AdminRow[]>("/api/payments"));
    setLoading(false);
  }

  useEffect(() => {
    load().catch((error) => {
      notifyError(error.message);
      setLoading(false);
    });
  }, [notifyError]);

  const filteredRows = useMemo(() => rows.filter((row) => (status ? row.status === status : true)), [rows, status]);

  const columns: GridColDef[] = [
    { field: "cohort", headerName: "Cohort", flex: 1.2, minWidth: 220, valueGetter: (_value, row) => row.cohort?.title ?? "" },
    { field: "organization", headerName: "Organization", flex: 1, minWidth: 200, valueGetter: (_value, row) => formatProperDisplay(row.organization?.name ?? "") },
    { field: "invoiceNumber", headerName: "Invoice", width: 150 },
    { field: "method", headerName: "Method", width: 150, valueFormatter: (value) => formatStatusLabel(String(value ?? "")) },
    { field: "status", headerName: "Status", width: 150, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "amount", headerName: "Amount", width: 130, valueFormatter: (value) => `$${Number(value ?? 0).toLocaleString()}` },
    { field: "paymentDate", headerName: "Payment date", width: 160, valueFormatter: (value) => value ? new Date(value).toLocaleDateString("en-US") : "" },
    {
      field: "actions",
      headerName: "Actions",
      width: 84,
      sortable: false,
      renderCell: (params) => (
        <Box onClick={(event) => event.stopPropagation()}>
          <RowActionMenu
            actions={[
              {
                label: "Mark paid",
                icon: <CheckCircleOutline fontSize="small" />,
                color: "success",
                onClick: async () => {
                  try {
                    await adminApi("/api/payments", { method: "PATCH", body: { id: params.row.id, status: "PAID", paymentDate: new Date().toISOString() } });
                    notifySuccess("Payment marked paid");
                    await load();
                  } catch (error) {
                    notifyError((error as Error).message);
                  }
                }
              }
            ]}
          />
        </Box>
      )
    }
  ];

  return (
    <PageStack>
      <PageHeader title="Payments" description="Track invoices, payment methods, payment status, and payment dates." />
      <CompactFilterBar resultCount={filteredRows.length}>
        <TextField select label="Payment status" value={status} onChange={(event) => setStatus(event.target.value)} sx={{ minWidth: 220 }}>
          <MenuItem value="">All statuses</MenuItem>
          {paymentStatuses.map((value) => <MenuItem key={value} value={value}>{formatStatusLabel(value)}</MenuItem>)}
        </TextField>
      </CompactFilterBar>
      <SectionCard title="Payment Records">
        <TableShell>
          <AppDataGrid rows={filteredRows} columns={columns} loading={loading} initialState={{ pagination: { paginationModel: { pageSize: 10 } } }} />
        </TableShell>
        {!loading && filteredRows.length === 0 && <EmptyState title="No payment records found" description="Payment records are created from registrations or webhook submissions." />}
      </SectionCard>
      <Box>{snackbar}</Box>
    </PageStack>
  );
}
