import { OrganizationDetailClient } from "@/components/admin/OrganizationDetailClient";

export default async function OrganizationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrganizationDetailClient id={id} />;
}
