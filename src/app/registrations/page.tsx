import { RegistrationsClient } from "@/components/admin/RegistrationsClient";

export default async function Page({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  return <RegistrationsClient requestedRegistrationId={(await searchParams).id} />;
}
