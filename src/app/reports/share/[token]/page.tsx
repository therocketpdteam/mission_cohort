import { Box, Container, Grid, Stack, Typography } from "@mui/material";
import { getSharedReport } from "@/services/reportService";

export default async function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const report = await getSharedReport(token);
  const rows = report.data;

  return (
    <Container maxWidth="lg" sx={{ py: 5 }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="h1">{report.link.title}</Typography>
          <Typography color="text.secondary">Thought leader summary. No names, emails, or phone numbers are included.</Typography>
        </Box>
        <Grid container spacing={2}>
          {rows.map((row) => (
            <Grid size={{ xs: 12 }} key={row.cohort.id}>
              <Box sx={{ bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: 1, p: 3 }}>
                <Typography variant="h2">{row.cohort.title}</Typography>
                <Grid container spacing={2} sx={{ mt: 1 }}>
                  {[
                    ["Registrations", row.registrationSummary.total],
                    ["Participants", row.participantSummary.total],
                    ["Pending Amount", `$${Number(row.paymentSummary.pendingAmount).toLocaleString()}`],
                    ["Open Tasks", row.readiness.openTasks],
                    ["Scheduled Emails", row.readiness.scheduledCommunications]
                  ].map(([label, value]) => (
                    <Grid size={{ xs: 12, sm: 6, md: 2.4 }} key={String(label)}>
                      <Typography variant="body2" color="text.secondary">{label}</Typography>
                      <Typography variant="h3">{value}</Typography>
                    </Grid>
                  ))}
                </Grid>
              </Box>
            </Grid>
          ))}
        </Grid>
      </Stack>
    </Container>
  );
}
