import type { Metadata, Route } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mission Control",
  description: "Internal cohort operations admin platform"
};

const navItems: ReadonlyArray<{ label: string; href: Route }> = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Cohorts", href: "/cohorts" },
  { label: "Registrations", href: "/registrations" },
  { label: "Participants", href: "/participants" },
  { label: "Organizations", href: "/organizations" },
  { label: "Presenters", href: "/presenters" },
  { label: "Communications", href: "/communications" },
  { label: "Payments", href: "/payments" },
  { label: "Forms", href: "/forms" },
  { label: "Settings", href: "/settings" }
];

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <aside className="sidebar">
            <h1>Mission Control</h1>
            <nav aria-label="Admin navigation">
              {navItems.map(({ label, href }) => (
                <Link href={href} key={href}>
                  {label}
                </Link>
              ))}
            </nav>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
