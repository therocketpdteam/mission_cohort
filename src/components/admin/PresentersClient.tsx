"use client";

import { EditOutlined } from "@/components/ui/icons";
import { PersonOffOutlined } from "@/components/ui/icons";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, TextField, Typography } from "@/components/ui/primitives";
import { GridColDef } from "./common";
import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { adminApi } from "@/lib/adminApi";
import { formatProperDisplay } from "@/lib/formatting";
import {
  AdminRow,
  AppDataGrid,
  CompactFilterBar,
  EmptyState,
  PageHeader,
  PageStack,
  RowActionMenu,
  SectionCard,
  StatusChip,
  TableShell,
  ToolbarButton,
  useNotifier
} from "./common";

type QuickBooksRefState = {
  vendors: AdminRow[];
  accounts: AdminRow[];
  environment?: string;
  realmId?: string;
};

function presenterInitialValues(row?: AdminRow | null) {
  return {
    firstName: row?.firstName ?? "",
    lastName: row?.lastName ?? "",
    shortName: row?.shortName ?? "",
    email: row?.email ?? "",
    organization: row?.organization ?? "",
    phone: row?.phone ?? "",
    bio: row?.bio ?? "",
    quickBooksVendorRef: row?.quickBooksVendorRef ?? "",
    quickBooksExpenseAccountRef: row?.quickBooksExpenseAccountRef ?? "",
    notes: row?.notes ?? "",
    active: row?.active ?? true
  };
}

function refLabel(row: AdminRow) {
  return String(row.fullyQualifiedName ?? row.name ?? row.id ?? "");
}

function PresenterDialog({
  open,
  presenter,
  refs,
  loadingRefs,
  onLoadRefs,
  onClose,
  onSubmit
}: {
  open: boolean;
  presenter: AdminRow | null;
  refs: QuickBooksRefState;
  loadingRefs: boolean;
  onLoadRefs: () => Promise<void>;
  onClose: () => void;
  onSubmit: (values: AdminRow) => Promise<void>;
}) {
  const [values, setValues] = useState<AdminRow>(() => presenterInitialValues(presenter));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setValues(presenterInitialValues(presenter));
      setError("");
    }
  }, [open, presenter]);

  function setValue(name: string, value: unknown) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!values.firstName || !values.lastName || !values.email) {
      setError("First name, last name, and email are required.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await onSubmit(values);
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to save presenter.");
    } finally {
      setSaving(false);
    }
  }

  const vendorOptions = refs.vendors.length > 0
    ? refs.vendors
    : values.quickBooksVendorRef ? [{ id: values.quickBooksVendorRef, fullyQualifiedName: `Saved vendor ref ${values.quickBooksVendorRef}` }] : [];
  const accountOptions = refs.accounts.length > 0
    ? refs.accounts
    : values.quickBooksExpenseAccountRef ? [{ id: values.quickBooksExpenseAccountRef, fullyQualifiedName: `Saved account ref ${values.quickBooksExpenseAccountRef}` }] : [];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md">
      <DialogTitle>{presenter ? "Edit Thought Leader" : "Create Thought Leader"}</DialogTitle>
      <form onSubmit={submit}>
        <DialogContent>
          {error && <Alert severity="error">{error}</Alert>}
          <div className="ui-grid" style={{ gap: 14, marginTop: 12 }}>
            <TextField fullWidth label="First name" required value={values.firstName ?? ""} onChange={(event) => setValue("firstName", event.currentTarget.value)} />
            <TextField fullWidth label="Last name" required value={values.lastName ?? ""} onChange={(event) => setValue("lastName", event.currentTarget.value)} />
            <TextField fullWidth label="Short name" placeholder="KM" value={values.shortName ?? ""} onChange={(event) => setValue("shortName", event.currentTarget.value)} />
            <TextField fullWidth label="Email" type="email" required value={values.email ?? ""} onChange={(event) => setValue("email", event.currentTarget.value)} />
            <TextField fullWidth label="Organization" value={values.organization ?? ""} onChange={(event) => setValue("organization", event.currentTarget.value)} />
            <TextField fullWidth label="Phone" value={values.phone ?? ""} onChange={(event) => setValue("phone", event.currentTarget.value)} />
            <div style={{ gridColumn: "1 / -1" }}>
              <div className="section-inline-header">
                <div>
                  <Typography variant="subtitle2">QuickBooks payout defaults</Typography>
                  <Typography variant="body2" color="text.secondary">New cohort payout settings can inherit these refs.</Typography>
                </div>
                <Button type="button" size="small" variant="outlined" onClick={() => void onLoadRefs()} disabled={loadingRefs}>
                  {loadingRefs ? "Loading..." : "Refresh QBO refs"}
                </Button>
              </div>
            </div>
            <TextField select fullWidth label="QBO vendor" value={values.quickBooksVendorRef ?? ""} onChange={(event) => setValue("quickBooksVendorRef", event.currentTarget.value)}>
              <MenuItem value="">No vendor selected</MenuItem>
              {vendorOptions.map((vendor) => <MenuItem value={vendor.id} searchText={vendor.searchText ?? refLabel(vendor)} key={vendor.id}>{refLabel(vendor)}</MenuItem>)}
            </TextField>
            <TextField select fullWidth label="QBO expense account" value={values.quickBooksExpenseAccountRef ?? ""} onChange={(event) => setValue("quickBooksExpenseAccountRef", event.currentTarget.value)}>
              <MenuItem value="">No expense account selected</MenuItem>
              {accountOptions.map((account) => <MenuItem value={account.id} searchText={account.searchText ?? refLabel(account)} key={account.id}>{[refLabel(account), account.type, account.subtype].filter(Boolean).join(" · ")}</MenuItem>)}
            </TextField>
            {refs.realmId && (
              <div style={{ gridColumn: "1 / -1" }}>
                <Typography variant="caption" color="text.secondary">Loaded from QuickBooks {refs.environment} company {refs.realmId}.</Typography>
              </div>
            )}
            <TextField fullWidth multiline minRows={4} label="Bio" value={values.bio ?? ""} onChange={(event) => setValue("bio", event.currentTarget.value)} />
            <TextField fullWidth multiline minRows={4} label="Notes" value={values.notes ?? ""} onChange={(event) => setValue("notes", event.currentTarget.value)} />
          </div>
        </DialogContent>
        <DialogActions>
          <Button type="button" variant="outlined" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? "Saving" : "Save"}</Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export function PresentersClient({ embedded = false }: { embedded?: boolean } = {}) {
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminRow | null>(null);
  const [search, setSearch] = useState("");
  const [quickBooksRefs, setQuickBooksRefs] = useState<QuickBooksRefState>({ vendors: [], accounts: [] });
  const [loadingQuickBooksRefs, setLoadingQuickBooksRefs] = useState(false);
  const autoLoadedQuickBooksRefs = useRef(false);
  const { notifySuccess, notifyError, snackbar } = useNotifier();

  async function load() {
    setRows(await adminApi<AdminRow[]>("/api/presenters"));
    setLoading(false);
  }

  useEffect(() => {
    load().catch((error) => {
      notifyError(error.message);
      setLoading(false);
    });
  }, [notifyError]);

  const filteredRows = useMemo(
    () => rows.filter((row) => [row.firstName, row.lastName, row.email, row.organization, row.quickBooksVendorRef].join(" ").toLowerCase().includes(search.toLowerCase())),
    [rows, search]
  );

  const columns: GridColDef[] = [
    { field: "name", headerName: "Name", flex: 1, minWidth: 180, valueGetter: (_value, row) => formatProperDisplay(`${row.firstName} ${row.lastName}`) },
    { field: "shortName", headerName: "Short", width: 100 },
    { field: "email", headerName: "Email", flex: 1, minWidth: 220 },
    { field: "organization", headerName: "Organization", flex: 1, minWidth: 200, valueGetter: (_value, row) => formatProperDisplay(row.organization ?? "") },
    { field: "quickBooksVendorRef", headerName: "QBO Vendor", width: 132, valueGetter: (_value, row) => row.quickBooksVendorRef ? "Linked" : "Missing" },
    { field: "active", headerName: "Active", width: 120, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "cohortCount", headerName: "Cohorts", width: 120, valueGetter: (_value, row) => row._count?.cohorts ?? 0 },
    {
      field: "actions",
      headerName: "Actions",
      width: 84,
      sortable: false,
      renderCell: (params) => (
        <Box onClick={(event) => event.stopPropagation()}>
          <RowActionMenu
            actions={[
              { label: "Edit presenter", icon: <EditOutlined fontSize="small" />, onClick: () => { setEditing(params.row); setDialogOpen(true); } },
              {
                label: "Deactivate presenter",
                icon: <PersonOffOutlined fontSize="small" />,
                color: "warning",
                disabled: !params.row.active,
                onClick: async () => {
                  try {
                    await adminApi("/api/presenters", { method: "PATCH", body: { id: params.row.id, active: false } });
                    notifySuccess("Presenter deactivated");
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

  async function save(values: AdminRow) {
    try {
      await adminApi("/api/presenters", {
        method: editing ? "PATCH" : "POST",
        body: editing ? { ...values, id: editing.id } : values
      });
      notifySuccess(editing ? "Presenter updated" : "Presenter created");
      setEditing(null);
      await load();
    } catch (error) {
      notifyError((error as Error).message);
      throw error;
    }
  }

  const quickBooksRefsLoaded = Boolean(quickBooksRefs.realmId || quickBooksRefs.vendors.length > 0 || quickBooksRefs.accounts.length > 0);

  useEffect(() => {
    if (!dialogOpen || quickBooksRefsLoaded || loadingQuickBooksRefs || autoLoadedQuickBooksRefs.current) {
      return;
    }

    autoLoadedQuickBooksRefs.current = true;
    void loadQuickBooksRefs({ silent: true });
  }, [dialogOpen, loadingQuickBooksRefs, quickBooksRefsLoaded]);

  async function loadQuickBooksRefs(options: { silent?: boolean } = {}) {
    setLoadingQuickBooksRefs(true);
    try {
      const refs = await adminApi<QuickBooksRefState>("/api/integrations/setup?provider=QUICKBOOKS&action=listAccountingRefs");
      setQuickBooksRefs({
        vendors: refs.vendors ?? [],
        accounts: refs.accounts ?? [],
        environment: refs.environment,
        realmId: refs.realmId
      });
      if (!options.silent) {
        notifySuccess("QuickBooks vendor and expense refs loaded");
      }
    } catch (error) {
      notifyError((error as Error).message);
    } finally {
      setLoadingQuickBooksRefs(false);
    }
  }

  return (
    <PageStack>
      {!embedded && (
        <PageHeader
          title="Thought Leaders"
          description="Manage thought leaders, delivery profiles, and QuickBooks payout defaults."
          action={(
            <div className="section-action-row">
              <Button variant="outlined" onClick={() => void loadQuickBooksRefs()} disabled={loadingQuickBooksRefs}>{loadingQuickBooksRefs ? "Loading..." : "Refresh QBO refs"}</Button>
              <ToolbarButton onClick={() => setDialogOpen(true)}>Create Thought Leader</ToolbarButton>
            </div>
          )}
        />
      )}
      <CompactFilterBar resultCount={filteredRows.length}>
        <TextField label="Search" value={search} onChange={(event) => setSearch(event.target.value)} />
        {embedded && (
          <>
            <Button variant="outlined" onClick={() => void loadQuickBooksRefs()} disabled={loadingQuickBooksRefs}>{loadingQuickBooksRefs ? "Loading..." : "Refresh QBO refs"}</Button>
            <ToolbarButton onClick={() => setDialogOpen(true)}>Create Thought Leader</ToolbarButton>
          </>
        )}
      </CompactFilterBar>
      <SectionCard title="Thought Leader Directory">
        <TableShell>
          <AppDataGrid rows={filteredRows} columns={columns} loading={loading} initialState={{ pagination: { paginationModel: { pageSize: 10 } } }} />
        </TableShell>
        {!loading && filteredRows.length === 0 && <EmptyState title="No thought leaders found" description="Create a thought leader to attach to cohorts and payout settings." />}
      </SectionCard>
      <PresenterDialog
        open={dialogOpen}
        presenter={editing}
        refs={quickBooksRefs}
        loadingRefs={loadingQuickBooksRefs}
        onLoadRefs={loadQuickBooksRefs}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
        onSubmit={save}
      />
      <Box>{snackbar}</Box>
    </PageStack>
  );
}
