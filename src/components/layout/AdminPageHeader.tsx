type AdminPageHeaderProps = {
  eyebrow?: string;
  title: string;
  description: string;
};

export function AdminPageHeader({ eyebrow = "Admin Operations", title, description }: AdminPageHeaderProps) {
  return (
    <header>
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      <p className="muted">{description}</p>
    </header>
  );
}
