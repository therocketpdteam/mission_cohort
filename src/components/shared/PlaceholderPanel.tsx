import { AdminPageHeader } from "@/components/layout/AdminPageHeader";

type PlaceholderPanelProps = {
  title: string;
  description: string;
};

export function PlaceholderPanel({ title, description }: PlaceholderPanelProps) {
  return (
    <section className="page-panel">
      <AdminPageHeader title={title} description={description} />
    </section>
  );
}
