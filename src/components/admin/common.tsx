"use client";

import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
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

  useEffect(() => {
    if (open) {
      setValues(initialValues ?? {});
    }
  }, [initialValues, open]);

  function setValue(name: string, value: unknown) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  async function submit() {
    setSaving(true);
    try {
      await onSubmit(values);
      onClose();
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
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          {fields.map((field) => (
            <Grid size={{ xs: 12, md: field.type === "textarea" ? 12 : 6 }} key={field.name}>
              {field.type === "select" ? (
                <FormControl fullWidth>
                  <InputLabel>{field.label}</InputLabel>
                  <Select
                    label={field.label}
                    value={values[field.name] ?? ""}
                    onChange={(event) => setValue(field.name, event.target.value)}
                  >
                    {(field.options ?? []).map((option) => (
                      <MenuItem value={option.value} key={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
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
    <Box sx={{ width: "100%", minHeight: 420, "& .MuiDataGrid-root": { minHeight: 420 } }}>
      {children}
    </Box>
  );
}
