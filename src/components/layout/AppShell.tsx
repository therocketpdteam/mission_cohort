"use client";

import {
  AccountCircle,
  ArticleOutlined,
  CalendarMonthOutlined,
  CheckCircleOutline,
  DashboardOutlined,
  EmailOutlined,
  GroupsOutlined,
  InsightsOutlined,
  LogoutOutlined,
  MenuIcon,
  MoonOutlined,
  SettingsOutlined,
  SunOutlined
} from "@/components/ui/icons";
import { Button, IconButton } from "@/components/ui/primitives";
import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/adminApi";
import { NewVersionPrompt } from "./NewVersionPrompt";

const navItems: ReadonlyArray<{
  label: string;
  href: Route;
  icon: ReactNode;
}> = [
  { label: "Dashboard", href: "/dashboard", icon: <DashboardOutlined /> },
  { label: "Cohorts", href: "/cohorts", icon: <CalendarMonthOutlined /> },
  { label: "Registrations", href: "/registrations", icon: <ArticleOutlined /> },
  { label: "Participants", href: "/participants", icon: <GroupsOutlined /> },
  { label: "Payments", href: "/payments", icon: <CheckCircleOutline /> },
  { label: "Communications", href: "/communications", icon: <EmailOutlined /> },
  { label: "Reports", href: "/reports", icon: <InsightsOutlined /> },
  { label: "Settings", href: "/settings", icon: <SettingsOutlined /> }
];

function titleFromPath(pathname: string) {
  const current = navItems.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  return current?.label ?? "Mission Control";
}

function breadcrumbsFor(pathname: string, labels: Record<string, string> = {}) {
  const parts = pathname.split("/").filter(Boolean);
  return ["Mission Control", ...parts.map((part, index) => {
    const key = `/${parts.slice(0, index + 1).join("/")}`;
    return labels[key] ?? part.replace(/-/g, " ");
  })];
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [density, setDensity] = useState<"standard" | "compact">("standard");
  const [themeMode, setThemeMode] = useState<"normal" | "night">("normal");
  const [user, setUser] = useState<{ firstName?: string; lastName?: string; email?: string; role?: string } | null>(null);
  const [breadcrumbLabels, setBreadcrumbLabels] = useState<Record<string, string>>({});
  const title = titleFromPath(pathname);
  const crumbs = useMemo(() => breadcrumbsFor(pathname, breadcrumbLabels), [breadcrumbLabels, pathname]);

  useEffect(() => {
    if (pathname === "/login" || pathname.startsWith("/reports/share/")) return;

    adminApi<{ firstName?: string; lastName?: string; email?: string; role?: string }>("/api/auth/me")
      .then(setUser)
      .catch(() => setUser(null));
  }, [pathname]);

  useEffect(() => {
    const match = pathname.match(/^\/cohorts\/([^/]+)$/);
    if (!match) return;

    const cohortId = match[1];
    if (!cohortId) return;

    const cohortPath = `/cohorts/${cohortId}`;
    adminApi<{ title?: string }>(`/api/cohorts/${cohortId}`)
      .then((cohort) => {
        const cohortTitle = cohort?.title;
        if (!cohortTitle) return;
        setBreadcrumbLabels((current) => ({ ...current, "/cohorts": "Cohorts", [cohortPath]: cohortTitle }));
      })
      .catch(() => undefined);
  }, [pathname]);

  useEffect(() => {
    const storedDensity = window.localStorage.getItem("mission-dashboard-density");
    const storedTheme = window.localStorage.getItem("mission-dashboard-theme");

    if (storedDensity === "compact" || storedDensity === "standard") {
      setDensity(storedDensity);
    }

    if (storedTheme === "night" || storedTheme === "normal") {
      setThemeMode(storedTheme);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("mission-dashboard-density", density);
  }, [density]);

  useEffect(() => {
    window.localStorage.setItem("mission-dashboard-theme", themeMode);
  }, [themeMode]);

  async function logout() {
    await adminApi("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setMenuOpen(false);
    setUser(null);
    router.replace("/login");
    router.refresh();
  }

  if (pathname === "/login" || pathname.startsWith("/reports/share/")) {
    return <main>{children}</main>;
  }

  return (
    <div className={`app-shell is-${density} is-${themeMode}`}>
      <aside className={`app-sidebar ${mobileOpen ? "is-open" : ""}`}>
        <div className="app-brand">
          <p className="app-brand-title">RocketPD</p>
          <p className="app-brand-subtitle">Mission Control</p>
        </div>
        <nav className="app-nav" aria-label="Admin navigation">
          {navItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link className={`app-nav-item ${active ? "is-active" : ""}`} href={item.href} key={item.href} onClick={() => setMobileOpen(false)}>
                {item.icon}
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="app-main">
        <header className="app-topbar">
          <IconButton type="button" className="mobile-menu-button" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <MenuIcon />
          </IconButton>
          <div className="app-topbar-title">
            <h1>{title}</h1>
            <div className="app-breadcrumbs">
              {crumbs.map((crumb, index) => (
                <span key={`${crumb}-${index}`}>{index > 0 ? `/ ${crumb}` : crumb}</span>
              ))}
            </div>
          </div>
          <div className="app-view-controls" aria-label="View controls">
            <div className="app-density-toggle" aria-label="Density">
              <button type="button" className={density === "standard" ? "is-active" : ""} onClick={() => setDensity("standard")}>
                Standard
              </button>
              <button type="button" className={density === "compact" ? "is-active" : ""} onClick={() => setDensity("compact")}>
                Compact
              </button>
            </div>
            <IconButton size="small" className={themeMode === "normal" ? "is-active" : ""} onClick={() => setThemeMode("normal")} aria-label="Normal mode">
              <SunOutlined />
            </IconButton>
            <IconButton size="small" className={themeMode === "night" ? "is-active" : ""} onClick={() => setThemeMode("night")} aria-label="Night mode">
              <MoonOutlined />
            </IconButton>
          </div>
          <div className="user-menu">
            <Button type="button" variant="outlined" startIcon={<AccountCircle />} onClick={() => setMenuOpen((current) => !current)}>
              {user?.firstName ?? "Admin"}
            </Button>
            {menuOpen && (
              <div className="user-popover">
                <div className="ui-menu-item" style={{ cursor: "default" }}>
                  <span className="ui-avatar">{user?.firstName?.[0] ?? "A"}</span>
                  <span>
                    <strong>{[user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Internal Admin"}</strong>
                    <br />
                    <small>{user?.role ?? "ADMIN"}</small>
                  </span>
                </div>
                <button type="button" className="ui-menu-item" onClick={logout}>
                  <LogoutOutlined fontSize="small" />
                  <span>Logout</span>
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="app-content">{children}</main>
      </div>
      <NewVersionPrompt />
    </div>
  );
}
