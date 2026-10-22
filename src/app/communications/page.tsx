import { CommunicationsClient } from "@/components/admin/CommunicationsClient";

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  return <CommunicationsClient requestedTab={(await searchParams).tab} />;
}
