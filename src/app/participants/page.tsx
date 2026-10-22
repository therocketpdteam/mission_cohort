import { ParticipantsClient } from "@/components/admin/ParticipantsClient";

export default async function Page({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  return <ParticipantsClient participantId={(await searchParams).id} />;
}
