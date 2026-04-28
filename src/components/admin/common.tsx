"use client";

import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
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
  MenuItem,
  Paper,
  Switch,
  Snackbar,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import { ReactNode, useCallback, useEffect, useState } from "react";

export type AdminRow = Record<string, any>;

export type FieldConfig = {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "datetime-local" | "email" | "textarea" | "select" | "checkbox";
  options?: Array<{ label: string; value: string }>;
  required?: boolean;
};

export function PageStack({ children }: { children: ReactNode }) {
  return (
    <Stack spacing={3} sx={{ maxWidth: 1600 }}>
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
    <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ xs: "stretch", md: "center" }} justifyContent="space-between">
      <Box>
        <Typography variant="h1">{title}</Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          {description}
        </Typography>
      </Box>
      {action}
    </Stack>
  );
}

export function SectionCard({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Card>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Typography variant="h3">{title}</Typography>
          {action}
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
  const text = typeof value === "boolean" ? (value ? "Active" : "Inactive") : value ?? "Unknown";
  const normalized = String(text).toLowerCase();
  const color =
    normalized.includes("paid") || normalized.includes("confirmed") || normalized.includes("active")
      ? "success"
      : normalized.includes("pending") || normalized.includes("draft") || normalized.includes("scheduled")
        ? "warning"
        : normalized.includes("cancel") || normalized.includes("failed")
          ? "error"
          : "default";

  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 999,
        px: 1,
        py: 0.25,
        fontSize: 12,
        fontWeight: 700,
        bgcolor: `${color}.light`,
        color: color === "default" ? "text.primary" : `${color}.dark`
      }}
    >
      {String(text).replace(/_/g, " ")}
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
    <Box sx={{ width: "100%", minHeight: 420, "& .MuiDataGrid-root": { minHeight: 420 }, "& .MuiDataGrid-cell": { alignItems: "center" } }}>
      {children}
    </Box>
  );
}
