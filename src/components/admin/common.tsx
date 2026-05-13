"use client";

import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Switch,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import type { ButtonProps } from "@mui/material/Button";
import { DataGrid, type DataGridProps, type GridValidRowModel } from "@mui/x-data-grid";
import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { formatProperDisplay, formatRegistrationSource, formatStatusLabel } from "@/lib/formatting";

export type AdminRow = Record<string, any>;

export type FieldConfig = {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "datetime-local" | "email" | "password" | "textarea" | "select" | "checkbox";
  options?: Array<{ label: string; value: string }>;
  required?: boolean;
};

export function PageStack({ children }: { children: ReactNode }) {
  return (
    <Stack spacing={3} sx={{ maxWidth: 1600, mx: "auto", width: "100%" }}>
      {children}
    </Stack>
  );
}

export function ActionGroup({
  children,
  justify = "flex-end",
  sx
}: {
  children: ReactNode;
  justify?: "flex-start" | "flex-end" | "space-between";
  sx?: object;
}) {
  return (
    <Stack
      direction="row"
      flexWrap="wrap"
      useFlexGap
      gap={1}
      alignItems="center"
      justifyContent={{ xs: "flex-start", md: justify }}
      sx={sx}
    >
      {children}
    </Stack>
  );
}

export function PageHeader({
  title,
  description,
  action
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Stack direction={{ xs: "column", lg: "row" }} spacing={2} alignItems={{ xs: "stretch", lg: "center" }} justifyContent="space-between">
      <Box>
        <Typography variant="h1">{title}</Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          {description}
        </Typography>
      </Box>
      {action && <ActionGroup>{action}</ActionGroup>}
    </Stack>
  );
}

export function SectionCard({
  title,
  children,
  action,
  sx,
  contentSx
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  sx?: object;
  contentSx?: object;
}) {
  return (
    <Card sx={sx}>
      <CardContent sx={contentSx}>
        <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }} gap={1.5} sx={{ mb: 2 }}>
          <Typography variant="h3">{title}</Typography>
          {action && <ActionGroup>{action}</ActionGroup>}
        </Stack>
        {children}
      </CardContent>
    </Card>
  );
}

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <Stack alignItems="center" justifyContent="center" spacing={1.5} sx={{ minHeight: 180, color: "text.secondary" }}>
      <CircularProgress size={28} />
      <Typography variant="body2">{label}</Typography>
    </Stack>
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
    <Paper
      variant="outlined"
      sx={{
        minHeight: 180,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        p: 3,
        bgcolor: "background.default",
        borderStyle: "dashed"
      }}
    >
      <Stack spacing={1.5} alignItems="center" textAlign="center">
        <Typography variant="h4">{title}</Typography>
        <Typography color="text.secondary">{description}</Typography>
        {action}
      </Stack>
    </Paper>
  );
}

export function StatusChip({ value }: { value?: string | boolean | null }) {
  const text = formatStatusLabel(value);
  const normalized = String(text).toLowerCase();
  const color =
    normalized.includes("inactive") || normalized.includes("cancel") || normalized.includes("failed")
      ? "error"
      : normalized.includes("paid") || normalized.includes("confirmed") || normalized.includes("active") || normalized.includes("complete")
      ? "success"
      : normalized.includes("pending") || normalized.includes("draft") || normalized.includes("scheduled") || normalized.includes("needed") || normalized.includes("partial")
        ? "warning"
        : "default";

  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 999,
        px: 0.875,
        height: 24,
        lineHeight: "24px",
        fontSize: 11.5,
        fontWeight: 700,
        whiteSpace: "nowrap",
        maxWidth: "100%",
        overflow: "hidden",
        textOverflow: "ellipsis",
        bgcolor: color === "default" ? "#F1F5F9" : `${color}.light`,
        color: color === "default" ? "#334155" : `${color}.dark`
      }}
    >
      {text}
    </Box>
  );
}

export const StatusBadge = StatusChip;

export function CompactActionButton({
  label,
  icon,
  onClick,
  color = "primary",
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
      <span>
        <IconButton
          size="small"
          color={color}
          disabled={disabled}
          onClick={onClick}
          aria-label={label}
          sx={{
            width: 30,
            height: 30,
            border: 1,
            borderColor: "#CBD5E1",
            bgcolor: "background.paper",
            "&:hover": { bgcolor: "#F1F5F9" }
          }}
        >
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  );
}

export function FieldValuePill({
  label,
  value,
  secondary
}: {
  label: string;
  value?: unknown;
  secondary?: string;
}) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, maxWidth: "100%" }}>
      <Box
        component="span"
        sx={{
          borderRadius: 999,
          border: 1,
          borderColor: "divider",
          bgcolor: "#F8FAFC",
          color: "#071D33",
          px: 1,
          py: 0.35,
          fontSize: 12,
          fontWeight: 800,
          whiteSpace: "nowrap",
          maxWidth: 180,
          overflow: "hidden",
          textOverflow: "ellipsis"
        }}
      >
        {label}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" noWrap title={String(value ?? "")}>
          {value == null || value === "" ? "No response" : String(value)}
        </Typography>
        {secondary && (
          <Typography variant="caption" color="text.secondary" noWrap title={secondary}>
            {secondary}
          </Typography>
        )}
      </Box>
    </Stack>
  );
}

export function MetadataPill({ children, maxWidth = "100%" }: { children: ReactNode; maxWidth?: number | string }) {
  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 999,
        bgcolor: "#E8F5FC",
        color: "#123C5A",
        px: 1,
        py: 0.35,
        fontSize: 12,
        fontWeight: 800,
        maxWidth,
        minWidth: 0,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis"
      }}
    >
      {children}
    </Box>
  );
}

export function SourcePill({ row }: { row: AdminRow }) {
  const label = formatRegistrationSource(row);

  return (
    <Tooltip title={label}>
      <Box component="span" sx={{ display: "inline-flex", maxWidth: "100%", minWidth: 0 }}>
        <MetadataPill maxWidth="100%">
          {label}
        </MetadataPill>
      </Box>
    </Tooltip>
  );
}

export function DateBadge({ value, emptyLabel = "No date" }: { value?: string | Date | null; emptyLabel?: string }) {
  const date = value ? new Date(value) : null;
  const month = date && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-US", { month: "short" }).format(date) : "";
  const day = date && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-US", { day: "numeric" }).format(date) : "";

  return (
    <Box
      sx={{
        width: 58,
        minWidth: 58,
        borderRadius: 2,
        border: 1,
        borderColor: "#BDE6F8",
        bgcolor: "#E8F5FC",
        color: "#071D33",
        textAlign: "center",
        py: 0.65
      }}
    >
      {date && Number.isFinite(date.getTime()) ? (
        <>
          <Typography variant="caption" fontWeight={900} sx={{ display: "block", lineHeight: 1 }}>{month}</Typography>
          <Typography variant="h4" sx={{ lineHeight: 1.1 }}>{day}</Typography>
        </>
      ) : (
        <Typography variant="caption" fontWeight={800}>{emptyLabel}</Typography>
      )}
    </Box>
  );
}

export function RowActionMenu({
  actions
}: {
  actions: Array<{ label: string; icon?: ReactNode; onClick: () => void; color?: "primary" | "success" | "warning" | "error"; disabled?: boolean }>;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  return (
    <>
      <Tooltip title="Actions">
        <IconButton
          aria-label="Row actions"
          size="small"
          onClick={(event) => {
            event.stopPropagation();
            setAnchor(event.currentTarget);
          }}
          sx={{ width: 30, height: 30, border: 1, borderColor: "#CBD5E1", bgcolor: "background.paper", "&:hover": { bgcolor: "#F1F5F9" } }}
        >
          <MoreHorizIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {actions.map((action) => (
          <MenuItem
            key={action.label}
            disabled={action.disabled}
            onClick={(event) => {
              event.stopPropagation();
              setAnchor(null);
              action.onClick();
            }}
            sx={{ color: action.color ? `${action.color}.main` : undefined }}
          >
            {action.icon && <ListItemIcon sx={{ color: "inherit" }}>{action.icon}</ListItemIcon>}
            <ListItemText>{action.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
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
      const segment = {
        row,
        color: colors[index % colors.length],
        dasharray: `${length} ${Math.max(circumference - length, 0)}`,
        dashoffset: -offset
      };
      offset += length;
      return segment;
    });
  }, [circumference, rows, total, valueKey]);

  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems="center">
      <Box sx={{ position: "relative", width: size, height: size }}>
        <Box component="svg" viewBox="0 0 150 150" sx={{ width: size, height: size, transform: "rotate(-90deg)" }}>
          <circle cx="75" cy="75" r={radius} fill="none" stroke="#E2E8F0" strokeWidth="18" />
          {segments.map((segment) => (
            <circle
              key={`${segment.row[labelKey]}-${segment.color}`}
              cx="75"
              cy="75"
              r={radius}
              fill="none"
              stroke={segment.color}
              strokeWidth="18"
              strokeDasharray={segment.dasharray}
              strokeDashoffset={segment.dashoffset}
              strokeLinecap="round"
            />
          ))}
        </Box>
        <Stack alignItems="center" justifyContent="center" sx={{ position: "absolute", inset: 0 }}>
          <Typography variant="h3">${total.toLocaleString()}</Typography>
          <Typography variant="caption" color="text.secondary">total</Typography>
        </Stack>
      </Box>
      <Stack spacing={0.75} sx={{ minWidth: 0, width: "100%" }}>
        {rows.map((row, index) => (
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" key={`${row[labelKey]}-${index}`}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: 999, bgcolor: colors[index % colors.length] }} />
              <Typography variant="body2" noWrap>{row[labelKey]}</Typography>
            </Stack>
            <Typography variant="body2" fontWeight={800}>${Number(row[valueKey] ?? 0).toLocaleString()}</Typography>
          </Stack>
        ))}
        {rows.length === 0 && <Typography color="text.secondary">No payment data for this filter.</Typography>}
      </Stack>
    </Stack>
  );
}

export function ProperText({ value, strong = false }: { value?: string | null; strong?: boolean }) {
  return (
    <Typography fontWeight={strong ? 800 : undefined} noWrap title={formatProperDisplay(value)}>
      {formatProperDisplay(value) || "-"}
    </Typography>
  );
}

export function DetailField({ label, value, proper = false }: { label: string; value: unknown; proper?: boolean }) {
  const displayValue = proper ? formatProperDisplay(String(value ?? "")) : value;

  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography fontWeight={700} sx={{ overflowWrap: "anywhere" }}>
        {displayValue == null || displayValue === "" ? "-" : String(displayValue)}
      </Typography>
    </Box>
  );
}

export function useNotifier() {
  const [notice, setNotice] = useState<{ message: string; severity: "success" | "error" } | null>(null);

  return {
    notifySuccess: useCallback((message: string) => setNotice({ message, severity: "success" }), []),
    notifyError: useCallback((message: string) => setNotice({ message, severity: "error" }), []),
    snackbar: (
      <Snackbar open={Boolean(notice)} autoHideDuration={4500} onClose={() => setNotice(null)}>
        <Alert severity={notice?.severity ?? "success"} onClose={() => setNotice(null)} sx={{ width: "100%" }}>
          {notice?.message}
        </Alert>
      </Snackbar>
    )
  };
}

export function ToolbarButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <Button startIcon={<AddIcon />} onClick={onClick}>
      {children}
    </Button>
  );
}

export function AppButton(props: ButtonProps) {
  return <Button {...props} />;
}

export function AppDataGrid<R extends GridValidRowModel = AdminRow>({
  sx,
  rowHeight = 64,
  columnHeaderHeight = 44,
  pageSizeOptions = [10, 25, 50],
  disableRowSelectionOnClick = true,
  ...props
}: DataGridProps<R>) {
  const baseSx = {
    "& .MuiDataGrid-columnHeaderTitle": {
      fontWeight: 800,
      color: "#334155"
    },
    "& .MuiDataGrid-cell": {
      alignItems: "center",
      display: "flex",
      minWidth: 0,
      overflow: "hidden",
      py: 0.75
    },
    "& .MuiDataGrid-cellContent": {
      overflow: "hidden",
      textOverflow: "ellipsis"
    },
    "& .MuiDataGrid-row": {
      cursor: props.onRowClick ? "pointer" : "default"
    },
    "& .MuiDataGrid-cell:focus, & .MuiDataGrid-columnHeader:focus": {
      outline: "none"
    }
  };

  return (
    <DataGrid
      rowHeight={rowHeight}
      columnHeaderHeight={columnHeaderHeight}
      pageSizeOptions={pageSizeOptions}
      disableRowSelectionOnClick={disableRowSelectionOnClick}
      {...props}
      sx={Array.isArray(sx) ? [baseSx, ...sx] : [baseSx, sx]}
    />
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
    if (open) {
      setValues(initialValues ?? {});
    }
  }, [initialValues, open]);

  function setValue(name: string, value: unknown) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  async function submit() {
    const missing = fields.find((field) => field.required && !values[field.name]);

    if (missing) {
      setSubmitError(`${missing.label} is required`);
      return;
    }

    setSaving(true);
    setSubmitError(null);
    try {
      await onSubmit(values);
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Unable to save changes");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          {title}
          <IconButton onClick={onClose} aria-label="Close dialog">
            <CloseIcon />
          </IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent>
        {submitError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {submitError}
          </Alert>
        )}
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          {fields.map((field) => (
            <Grid size={{ xs: 12, md: field.type === "textarea" ? 12 : 6 }} key={field.name}>
              {field.type === "select" ? (
                <TextField
                  select
                  fullWidth
                  label={field.label}
                  required={field.required}
                  value={values[field.name] ?? ""}
                  onChange={(event) => setValue(field.name, event.target.value)}
                >
                  {(field.options ?? []).map((option) => (
                    <MenuItem value={option.value} key={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
              ) : field.type === "checkbox" ? (
                <FormControlLabel
                  control={
                    <Switch
                      checked={Boolean(values[field.name])}
                      onChange={(event) => setValue(field.name, event.target.checked)}
                    />
                  }
                  label={field.label}
                />
              ) : (
                <TextField
                  fullWidth
                  label={field.label}
                  required={field.required}
                  multiline={field.type === "textarea"}
                  minRows={field.type === "textarea" ? 4 : undefined}
                  type={field.type ?? "text"}
                  InputLabelProps={["date", "datetime-local"].includes(field.type ?? "") ? { shrink: true } : undefined}
                  value={values[field.name] ?? ""}
                  onChange={(event) => {
                    const raw = event.target.value;
                    setValue(field.name, field.type === "number" ? Number(raw) : raw);
                  }}
                />
              )}
            </Grid>
          ))}
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={saving}>
          {saving ? "Saving" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function TableShell({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        width: "100%",
        minHeight: 420,
        "& .MuiDataGrid-root": { minHeight: 420 },
        "& .MuiDataGrid-cell": { alignItems: "center" },
        "& .MuiDataGrid-actionsCell": { gap: 1 }
      }}
    >
      {children}
    </Box>
  );
}
