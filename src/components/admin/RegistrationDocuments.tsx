"use client";

import { ArticleOutlined, DeleteOutline, VisibilityOutlined } from "@/components/ui/icons";
import { Box, Button, Stack, Typography } from "@/components/ui/primitives";
import { adminApi, uploadAdminFile } from "@/lib/adminApi";
import { useState } from "react";
import type { AdminRow } from "./common";
import { SectionCard } from "./common";

type DocumentType = "purchaseOrder" | "checkPayment";

export function RegistrationDocuments({ registration, onChanged, onError }: {
  registration: AdminRow;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [working, setWorking] = useState<DocumentType | "">("");

  async function upload(type: DocumentType, file?: File) {
    if (!file) return;
    setWorking(type);
    try {
      const result = await uploadAdminFile<{ fileKey: string }>(file, type === "purchaseOrder" ? "purchase-order" : "check-payment");
      await adminApi("/api/registrations", {
        method: "PATCH",
        body: {
          id: registration.id,
          action: "updateDocument",
          type,
          fileKey: result.fileKey,
          fileName: file.name,
          contentType: file.type
        }
      });
      await onChanged();
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setWorking("");
    }
  }

  async function remove(type: DocumentType) {
    setWorking(type);
    try {
      await adminApi("/api/registrations", {
        method: "PATCH",
        body: { id: registration.id, action: "updateDocument", type, fileKey: null, fileName: null, contentType: null }
      });
      await onChanged();
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setWorking("");
    }
  }

  const documents = [
    {
      type: "purchaseOrder" as const,
      label: "Purchase order",
      fileKey: registration.purchaseOrderFileKey,
      fileName: registration.purchaseOrderFileName
    },
    {
      type: "checkPayment" as const,
      label: "Check payment proof",
      fileKey: registration.checkPaymentFileKey,
      fileName: registration.checkPaymentFileName
    }
  ];

  return (
    <SectionCard title="Payment Documents">
      <Stack spacing={1.25}>
        {documents.map((document) => (
          <Stack
            key={document.type}
            direction={{ xs: "column", sm: "row" }}
            alignItems={{ xs: "stretch", sm: "center" }}
            justifyContent="space-between"
            spacing={2}
            sx={{ p: 1.5, border: "1px solid", borderColor: "divider", borderRadius: "8px", bgcolor: "action.hover" }}
          >
            <Stack direction="row" alignItems="center" spacing={1.25} sx={{ minWidth: 0 }}>
              <ArticleOutlined />
              <Box sx={{ display: "grid", gap: 0.25, minWidth: 0 }}>
                <strong>{document.label}</strong>
                <Typography component="span" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>{document.fileName || "No document uploaded"}</Typography>
              </Box>
            </Stack>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
              {document.fileKey ? (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<VisibilityOutlined />}
                  href={`/api/registration-documents?registrationId=${encodeURIComponent(registration.id)}&type=${document.type}`}
                  target="_blank"
                  rel="noreferrer"
                >View</Button>
              ) : null}
              <Button component="label" size="small" variant="outlined" disabled={Boolean(working)}>
                {working === document.type ? "Uploading" : document.fileKey ? "Replace" : "Upload"}
                <input hidden type="file" accept="application/pdf,image/*" onChange={(event) => void upload(document.type, event.currentTarget.files?.[0])} />
              </Button>
              {document.fileKey ? (
                <Button size="small" color="warning" startIcon={<DeleteOutline />} disabled={Boolean(working)} onClick={() => void remove(document.type)}>Remove</Button>
              ) : null}
            </Stack>
          </Stack>
        ))}
      </Stack>
    </SectionCard>
  );
}
