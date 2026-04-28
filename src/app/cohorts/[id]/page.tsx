import { CohortDetailClient } from "@/components/admin/CohortDetailClient";

export default async function CohortDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CohortDetailClient id={id} />;
}
