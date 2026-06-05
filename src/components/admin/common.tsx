"use client";

import { MoreHorizIcon, AddIcon, CloseIcon } from "@/components/ui/icons";
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Snackbar,
  Switch,
  TextField,
  Tooltip
} from "@/components/ui/primitives";
import type { FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatProperDisplay, formatRegistrationSource, formatStatusLabel } from "@/lib/formatting";
import { uploadAdminFile } from "@/lib/adminApi";

export type AdminRow = Record<string, any>;

export type FieldConfig = {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "datetime-local" | "email" | "password" | "textarea" | "select" | "checkbox" | "image";
  options?: Array<{ label: string; value: string }>;
  required?: boolean;
};

export type GridRowParams<R extends AdminRow = AdminRow> = {
  row: R;
  id: string | number;
};

export type GridRowSelectionModel = { type: "include" | "exclude"; ids: Set<string | number> };

export type GridRenderCellParams<R extends AdminRow = AdminRow> = {
  row: R;
  value: any;
  field: string;
};

export type GridColDef<R extends AdminRow = AdminRow> = {
  field: string;
  headerName?: string;
  width?: number;
  minWidth?: number;
  flex?: number;
  sortable?: boolean;
  valueGetter?: (value: any, row: R) => any;
  valueFormatter?: (value: any, row?: R) => ReactNode;
  renderCell?: (params: GridRenderCellParams<R>) => ReactNode;
};

export function PageStack({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`page-stack ${className}`.trim()}>{children}</div>;
}

export function ActionGroup({ children, justify = "flex-end" }: { children: ReactNode; justify?: "flex-start" | "flex-end" | "space-between"; sx?: object }) {
  return <div className="action-group" style={{ justifyContent: justify }}>{children}</div>;
}

export function PageHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action && <ActionGroup>{action}</ActionGroup>}
    </header>
  );
}

export function SectionCard({
  title,
  children,
  action
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  sx?: object;
  contentSx?: object;
}) {
  return (
    <section className="section-card">
      <div className="section-card-header">
        <h2 className="section-card-title">{title}</h2>
        {action && <ActionGroup>{action}</ActionGroup>}
      </div>
      {children}
    </section>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="filter-bar">{children}</div>;
}

export function CompactFilterBar({
  children,
  advanced,
  resultCount
}: {
  children: ReactNode;
  advanced?: ReactNode;
  resultCount?: number;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <section className="compact-filter-bar">
      <div className="compact-filter-row">
        {children}
        {advanced && (
          <Button type="button" variant="outlined" size="small" onClick={() => setAdvancedOpen((current) => !current)}>
            More filters
          </Button>
        )}
        {typeof resultCount === "number" && <span className="compact-filter-count">{resultCount} records</span>}
      </div>
      {advanced && (
        <Dialog open={advancedOpen} onClose={() => setAdvancedOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>More filters</DialogTitle>
          <DialogContent>
            <div className="compact-filter-modal">{advanced}</div>
          </DialogContent>
          <DialogActions>
            <Button variant="outlined" onClick={() => setAdvancedOpen(false)}>Done</Button>
          </DialogActions>
        </Dialog>
      )}
    </section>
  );
}

export function QuickViewDrawer({
  title,
  open,
  onClose,
  children,
  actions
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="quick-view-backdrop" role="presentation" onClick={onClose}>
      <aside className="quick-view-drawer" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <header className="quick-view-header">
          <h2>{title}</h2>
          <IconButton type="button" onClick={onClose} aria-label="Close drawer">
            <CloseIcon />
          </IconButton>
        </header>
        <div className="quick-view-body">{children}</div>
        {actions && <footer className="quick-view-footer">{actions}</footer>}
      </aside>
    </div>
  );
}

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div className="loading-state">
      <div>
        <CircularProgress size={28} />
        <p>{label}</p>
      </div>
    </div>
  );
}

export function EmptyState({
  title = "No records yet",
  description = "Create a record or adjust filters to see results here.",
  action
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div>
        <h3 className="section-card-title">{title}</h3>
        <p>{description}</p>
        {action}
      </div>
    </div>
  );
}

export function StatusChip({ value }: { value?: unknown }) {
  const text = formatStatusLabel(value as string | boolean | null | undefined);
  const normalized = String(text).toLowerCase();
  const tone =
    normalized.includes("inactive") || normalized.includes("cancel") || normalized.includes("failed") || normalized.includes("overdue")
      ? "error"
      : normalized.includes("paid") || normalized.includes("confirmed") || normalized.includes("active") || normalized.includes("complete") || normalized.includes("processed")
        ? "success"
        : normalized.includes("pending") || normalized.includes("draft") || normalized.includes("scheduled") || normalized.includes("needed") || normalized.includes("partial")
          ? "warning"
          : "default";

  return (
    <Tooltip title={text}>
      <span className={`status-chip status-${tone}`}>
        <span>{text}</span>
      </span>
    </Tooltip>
  );
}

export const StatusBadge = StatusChip;

export function CompactActionButton({
  label,
  icon,
  onClick,
  disabled = false
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  color?: "primary" | "success" | "warning" | "error" | "info";
  disabled?: boolean;
}) {
  return (
    <Tooltip title={label}>
      <IconButton type="button" disabled={disabled} onClick={onClick} aria-label={label} size="small">
        {icon}
      </IconButton>
    </Tooltip>
  );
}

export function FieldValuePill({ label, value, secondary }: { label: string; value?: unknown; secondary?: string }) {
  const display = value == null || value === "" ? "No response" : String(value);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
      <span className="metadata-pill" style={{ maxWidth: 180 }}>
        <span>{label}</span>
      </span>
      <div style={{ minWidth: 0 }}>
        <div className="app-table-cell-content" title={display}>{display}</div>
        {secondary && <small className="app-table-cell-content" title={secondary}>{secondary}</small>}
      </div>
    </div>
  );
}

export function MetadataPill({ children, maxWidth = "100%" }: { children: ReactNode; maxWidth?: number | string }) {
  return (
    <span className="metadata-pill" style={{ maxWidth }}>
      <span>{children}</span>
    </span>
  );
}

export function SourcePill({ row }: { row: AdminRow }) {
  const label = formatRegistrationSource(row);
  return (
    <Tooltip title={label}>
      <MetadataPill>{label}</MetadataPill>
    </Tooltip>
  );
}

export function DateBadge({ value, emptyLabel = "No date" }: { value?: string | Date | null; emptyLabel?: string }) {
  const date = value ? new Date(value) : null;
  const valid = date && Number.isFinite(date.getTime());
  const month = valid ? new Intl.DateTimeFormat("en-US", { month: "short" }).format(date) : "";
  const day = valid ? new Intl.DateTimeFormat("en-US", { day: "numeric" }).format(date) : "";

  return (
    <span className="metadata-pill" style={{ minWidth: 58, justifyContent: "center" }}>
      <span>{valid ? `${month} ${day}` : emptyLabel}</span>
    </span>
  );
}

export function RowActionMenu({
  actions
}: {
  actions: Array<{ label: string; icon?: ReactNode; onClick: () => void; color?: "primary" | "success" | "warning" | "error"; disabled?: boolean }>;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function close(event: MouseEvent) {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function toggleMenu() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const menuWidth = 212;
      setPosition({
        top: rect.bottom + 6,
        left: Math.max(12, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 12))
      });
    }
    setOpen((current) => !current);
  }

  return (
    <span className="row-action-wrap">
      <Tooltip title="Actions">
        <IconButton
          ref={buttonRef}
          type="button"
          aria-label="Row actions"
          aria-haspopup="menu"
          aria-expanded={open}
          size="small"
          onClick={(event) => {
            event.stopPropagation();
            toggleMenu();
          }}
        >
          <MoreHorizIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      {open && position && createPortal(
        <div className="row-action-menu" ref={menuRef} role="menu" style={{ top: position.top, left: position.left }}>
          {actions.map((action) => (
            <button
              type="button"
              className="row-action-item"
              key={action.label}
              disabled={action.disabled}
              role="menuitem"
              onClick={(event) => {
                event.stopPropagation();
                setOpen(false);
                action.onClick();
              }}
            >
              {action.icon}
              <span>{action.label}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </span>
  );
}

export function DonutChart({
  rows,
  valueKey = "amount",
  labelKey = "label",
  size = 150
}: {
  rows: AdminRow[];
  valueKey?: string;
  labelKey?: string;
  size?: number;
}) {
  const colors = ["#1479C9", "#20C7D9", "#F59E0B", "#16A34A", "#DC2626", "#64748B"];
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  const total = rows.reduce((sum, row) => sum + Number(row[valueKey] ?? 0), 0);
  const segments = useMemo(() => {
    let offset = 0;
    return rows.map((row, index) => {
      const value = Number(row[valueKey] ?? 0);
      const length = total > 0 ? (value / total) * circumference : 0;
      const segment = { row, color: colors[index % colors.length], dasharray: `${length} ${Math.max(circumference - length, 0)}`, dashoffset: -offset };
      offset += length;
      return segment;
    });
  }, [circumference, rows, total, valueKey]);

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16 }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg viewBox="0 0 150 150" style={{ width: size, height: size, transform: "rotate(-90deg)" }}>
          <circle cx="75" cy="75" r={radius} fill="none" stroke="#E2E8F0" strokeWidth="18" />
          {segments.map((segment) => (
            <circle key={`${segment.row[labelKey]}-${segment.color}`} cx="75" cy="75" r={radius} fill="none" stroke={segment.color} strokeWidth="18" strokeDasharray={segment.dasharray} strokeDashoffset={segment.dashoffset} strokeLinecap="round" />
          ))}
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>
          <div>
            <strong>${total.toLocaleString()}</strong>
            <br />
            <small>total</small>
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gap: 6, minWidth: 220, flex: 1 }}>
        {rows.map((row, index) => {
          const value = Number(row[valueKey] ?? 0);
          const percent = total > 0 ? Math.round((value / total) * 100) : 0;

          return (
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }} key={`${row[labelKey]}-${index}`}>
            <span className="app-table-cell-content"><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 999, background: colors[index % colors.length], marginRight: 8 }} />{row[labelKey]}</span>
            <strong>${value.toLocaleString()} · {percent}%</strong>
          </div>
          );
        })}
        {rows.length === 0 && <p>No payment data for this filter.</p>}
      </div>
    </div>
  );
}

export function ProperText({ value, strong = false }: { value?: string | null; strong?: boolean }) {
  const text = formatProperDisplay(value);
  return <span className="app-table-cell-content" title={text} style={{ fontWeight: strong ? 800 : undefined }}>{text || "-"}</span>;
}

export function DetailField({ label, value, proper = false }: { label: string; value: unknown; proper?: boolean }) {
  const displayValue = proper ? formatProperDisplay(String(value ?? "")) : value;
  return (
    <div style={{ minWidth: 0 }}>
      <small style={{ color: "var(--color-slate-500)" }}>{label}</small>
      <div style={{ fontWeight: 750, overflowWrap: "anywhere" }}>{displayValue == null || displayValue === "" ? "-" : String(displayValue)}</div>
    </div>
  );
}

export function useNotifier() {
  const [notice, setNotice] = useState<{ message: string; severity: "success" | "error" } | null>(null);

  return {
    notifySuccess: useCallback((message: string) => setNotice({ message, severity: "success" }), []),
    notifyError: useCallback((message: string) => setNotice({ message, severity: "error" }), []),
    snackbar: (
      <Snackbar open={Boolean(notice)}>
        <Alert severity={notice?.severity ?? "success"}>{notice?.message}</Alert>
      </Snackbar>
    )
  };
}

export function ToolbarButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <Button type="button" startIcon={<AddIcon />} onClick={onClick}>
      {children}
    </Button>
  );
}

export function AppButton(props: React.ComponentProps<typeof Button>) {
  return <Button {...props} />;
}

function getCellValue<R extends AdminRow>(column: GridColDef<R>, row: R) {
  const raw = row[column.field];
  return column.valueGetter ? column.valueGetter(raw, row) : raw;
}

export function AppDataGrid<R extends AdminRow = AdminRow>({
  rows,
  columns,
  loading,
  initialState,
  pageSizeOptions = [25, 50, 100],
  onRowClick,
  checkboxSelection,
  rowSelectionModel = { type: "include", ids: new Set() },
  onRowSelectionModelChange
}: {
  rows: R[];
  columns: GridColDef<R>[];
  loading?: boolean;
  initialState?: { pagination?: { paginationModel?: { pageSize?: number } } };
  pageSizeOptions?: number[];
  rowHeight?: number;
  columnHeaderHeight?: number;
  disableRowSelectionOnClick?: boolean;
  onRowClick?: (params: GridRowParams<R>) => void;
  checkboxSelection?: boolean;
  rowSelectionModel?: GridRowSelectionModel;
  onRowSelectionModelChange?: (model: GridRowSelectionModel) => void;
  sx?: object;
}) {
  const normalizedOptions = Array.from(new Set([25, 50, 100, ...pageSizeOptions])).sort((a, b) => a - b);
  const [pageSize, setPageSize] = useState(initialState?.pagination?.paginationModel?.pageSize && normalizedOptions.includes(initialState.pagination.paginationModel.pageSize) ? initialState.pagination.paginationModel.pageSize : normalizedOptions[0]);
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const visibleRows = rows.slice(page * pageSize, page * pageSize + pageSize);
  const totalFlex = columns.reduce((sum, column) => sum + (column.width ? 0 : column.flex ?? 1), 0);

  useEffect(() => {
    setPage(0);
  }, [pageSize, rows.length]);

  const selectedIds = rowSelectionModel.ids;

  function toggleSelection(id: string | number) {
    const current = new Set(selectedIds);
    if (current.has(id)) {
      current.delete(id);
    } else {
      current.add(id);
    }
    onRowSelectionModelChange?.({ type: "include", ids: current });
  }

  if (loading) {
    return <LoadingState label="Loading records" />;
  }

  return (
    <div className="app-table-shell">
      <div className="app-table-scroll">
        <table className="app-table">
          <colgroup>
            {checkboxSelection && <col style={{ width: 44 }} />}
            {columns.map((column) => {
              const flexWidth = column.width ? undefined : `${((column.flex ?? 1) / Math.max(totalFlex, 1)) * 100}%`;
              return <col key={column.field} style={{ width: column.width ?? flexWidth, minWidth: column.minWidth ?? undefined }} />;
            })}
          </colgroup>
          <thead>
            <tr>
              {checkboxSelection && <th style={{ width: 44 }} />}
              {columns.map((column) => (
                <th key={column.field} style={{ width: column.width ?? undefined, minWidth: column.minWidth ?? undefined }}>
                  {column.headerName ?? column.field}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const id = row.id ?? rows.indexOf(row);
              return (
                <tr key={String(id)} className={onRowClick ? "app-table-row-clickable" : undefined} onClick={() => onRowClick?.({ row, id })}>
                  {checkboxSelection && (
                    <td onClick={(event) => event.stopPropagation()}>
                      <input type="checkbox" checked={selectedIds.has(id)} onChange={() => toggleSelection(id)} aria-label="Select row" />
                    </td>
                  )}
                  {columns.map((column) => {
                    const value = getCellValue(column, row);
                    const rendered = Boolean(column.renderCell);
                    const content = column.renderCell ? column.renderCell({ row, value, field: column.field }) : column.valueFormatter ? column.valueFormatter(value, row) : value;
                    return (
                      <td key={column.field}>
                        <div
                          className={`app-table-cell-content${rendered ? " app-table-cell-rendered" : ""}`}
                          title={typeof content === "string" || typeof content === "number" ? String(content) : undefined}
                        >
                          {content as ReactNode}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="table-footer">
        <span>
          {rows.length === 0 ? "No rows" : `${page * pageSize + 1}-${Math.min(rows.length, (page + 1) * pageSize)} of ${rows.length}`}
        </span>
        <div className="table-pager">
          <TextField select label="Rows" value={String(pageSize)} onChange={(event) => setPageSize(Number(event.target.value))} style={{ minWidth: 110 }}>
            {normalizedOptions.map((option) => <MenuItem value={option} key={option}>{option}</MenuItem>)}
          </TextField>
          <Button type="button" variant="outlined" size="small" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Previous</Button>
          <span>Page {page + 1} of {pageCount}</span>
          <Button type="button" variant="outlined" size="small" disabled={page >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>Next</Button>
        </div>
      </div>
    </div>
  );
}

export function MutationDialog({
  title,
  open,
  fields,
  initialValues,
  onClose,
  onSubmit
}: {
  title: string;
  open: boolean;
  fields: FieldConfig[];
  initialValues?: AdminRow;
  onClose: () => void;
  onSubmit: (values: AdminRow) => Promise<void>;
}) {
  const [values, setValues] = useState<AdminRow>(initialValues ?? {});
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setValues(initialValues ?? {});
  }, [initialValues, open]);

  function setValue(name: string, value: unknown) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  async function uploadImage(name: string, file?: File) {
    if (!file) {
      return;
    }

    setSaving(true);
    setSubmitError(null);
    try {
      const uploaded = await uploadAdminFile<{ url?: string }>(file, "cohort-thumbnail");
      if (!uploaded.url) {
        throw new Error("Image upload did not return a URL");
      }
      setValue(name, uploaded.url);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Unable to upload image");
    } finally {
      setSaving(false);
    }
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const missing = fields.find((field) => field.required && !values[field.name]);
    if (missing) {
      setSubmitError(`${missing.label} is required`);
      return;
    }

    setSaving(true);
    setSubmitError(null);
    try {
      const payload = fields.reduce<AdminRow>((current, field) => {
        current[field.name] = values[field.name];
        return current;
      }, {});
      await onSubmit(payload);
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Unable to save changes");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md">
      <DialogTitle>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <span>{title}</span>
          <IconButton type="button" onClick={onClose} aria-label="Close dialog"><CloseIcon /></IconButton>
        </div>
      </DialogTitle>
      <form onSubmit={submit}>
        <DialogContent>
          {submitError && <Alert severity="error">{submitError}</Alert>}
          <div className="ui-grid" style={{ gap: 14, marginTop: 12 }}>
            {fields.map((field) => (
              <div key={field.name} style={{ gridColumn: field.type === "textarea" || field.type === "image" ? "1 / -1" : undefined }}>
                {field.type === "select" ? (
                  <TextField select fullWidth label={field.label} required={field.required} value={values[field.name] ?? ""} onChange={(event) => setValue(field.name, event.currentTarget.value)}>
                    {(field.options ?? []).map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                  </TextField>
                ) : field.type === "checkbox" ? (
                  <FormControlLabel control={<Switch checked={Boolean(values[field.name])} onChange={(event) => setValue(field.name, event.target.checked)} />} label={field.label} />
                ) : field.type === "image" ? (
                  <div className="image-field">
                    <div className="image-field-preview">
                      {values[field.name] ? <img src={String(values[field.name])} alt="" /> : <span>No thumbnail</span>}
                    </div>
                    <div className="image-field-controls">
                      <TextField
                        fullWidth
                        label={field.label}
                        value={values[field.name] ?? ""}
                        onChange={(event) => setValue(field.name, event.currentTarget.value)}
                      />
                      <label className="ui-button ui-button-outlined">
                        <span>Upload image</span>
                        <input type="file" accept="image/*" onChange={(event) => void uploadImage(field.name, event.currentTarget.files?.[0])} hidden />
                      </label>
                    </div>
                  </div>
                ) : (
                  <TextField
                    fullWidth
                    label={field.label}
                    required={field.required}
                    multiline={field.type === "textarea"}
                    minRows={field.type === "textarea" ? 4 : undefined}
                    type={field.type ?? "text"}
                    value={values[field.name] ?? ""}
                    onChange={(event) => {
                      const raw = event.currentTarget.value;
                      setValue(field.name, field.type === "number" ? Number(raw) : raw);
                    }}
                  />
                )}
              </div>
            ))}
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

export function TableShell({ children }: { children: ReactNode }) {
  return <div className="app-table-shell">{children}</div>;
}
