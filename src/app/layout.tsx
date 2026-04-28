import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mission Control",
  description: "Internal cohort operations admin platform"
};

const navItems = [
  ["Dashboard", "/dashboard"],
  ["Cohorts", "/cohorts"],
  ["Registrations", "/registrations"],
  ["Participants", "/participants"],
  ["Organizations", "/organizations"],
  ["Presenters", "/presenters"],
  ["Communications", "/communications"],
  ["Payments", "/payments"],
  ["Forms", "/forms"],
  ["Settings", "/settings"]
];

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <aside className="sidebar">
            <h1>Mission Control</h1>
            <nav aria-label="Admin navigation">
              {navItems.map(([label, href]) => (
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
