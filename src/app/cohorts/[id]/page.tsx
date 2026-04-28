import { PlaceholderPanel } from "@/components/shared/PlaceholderPanel";

export default async function CohortDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <PlaceholderPanel
      title="Cohort Detail"
      description={`Admin detail placeholder for cohort ${id}.`}
    />
  );
}
