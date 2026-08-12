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
  SearchOutlined,
  SettingsOutlined,
  SunOutlined
} from "@/components/ui/icons";
import { Button, IconButton } from "@/components/ui/primitives";
import { formatCurrency, formatProperDisplay, formatStatusLabel } from "@/lib/formatting";
import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/adminApi";
import { NewVersionPrompt } from "./NewVersionPrompt";

type PeopleSearchResult = {
  id: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  participantListStatus: string;
  participantCount: number;
  savedParticipantCount: number;
  totalAmount: number;
  invoiceNumber?: string | null;
  purchaseOrderNumber?: string | null;
  primaryContactName: string;
  primaryContactEmail: string;
  billingContactName?: string | null;
  billingContactEmail?: string | null;
  archivedAt?: string | null;
  createdAt: string;
  cohort: {
    id: string;
    title: string;
    shortName?: string | null;
    slug: string;
    status: string;
    startDate: string;
  };
  organization: {
    id: string;
    name: string;
    type: string;
  };
  participants: Array<{
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    title?: string | null;
    status: string;
  }>;
  invoiceDrafts: Array<{
    id: string;
    invoiceNumber?: string | null;
    purchaseOrderNumber?: string | null;
    status: string;
    totalAmount: number;
    paidAmount: number;
    quickBooksInvoiceRef?: string | null;
    quickBooksInvoiceStatus: string;
  }>;
  paymentRecords: Array<{
    id: string;
    amount: number;
    status: string;
    method: string;
    invoiceNumber?: string | null;
  }>;
  links: {
    registration: string;
    cohort: string;
    communications: string;
  };
  matchTypes: string[];
};

type PeopleSearchGroup = {
  key: string;
  primaryEmail?: string;
  displayName: string;
  matchTypes: string[];
  registrations: PeopleSearchResult[];
};

type AppEnvironment = {
  kind: "production" | "staging" | "local";
  label: string;
  vercelEnvironment: string;
  backgroundJobsAllowed: boolean;
  outbound?: {
    required: boolean;
    locked: boolean;
    mode: "locked" | "unlocked" | "not_required";
    reason?: string;
  };
};

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

function subtitleFromPath(pathname: string) {
  if (pathname === "/dashboard") {
    return "Operational snapshot across active cohorts.";
  }

  return "";
}

function breadcrumbsFor(pathname: string, labels: Record<string, string> = {}) {
  const parts = pathname.split("/").filter(Boolean);
  return ["Mission Control", ...parts.map((part, index) => {
    const key = `/${parts.slice(0, index + 1).join("/")}`;
    return labels[key] ?? part.replace(/-/g, " ");
  })];
}

function formatShortDate(value?: string | null) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function participantName(participant: PeopleSearchResult["participants"][number]) {
  return formatProperDisplay([participant.firstName, participant.lastName].filter(Boolean).join(" ")) || participant.email;
}

function normalizedEmail(value?: string | null) {
  return String(value ?? "").trim().toLowerCase();
}

function resultEmails(result: PeopleSearchResult) {
  return Array.from(new Set([
    normalizedEmail(result.primaryContactEmail),
    normalizedEmail(result.billingContactEmail),
    ...result.participants.map((participant) => normalizedEmail(participant.email))
  ].filter(Boolean)));
}

function exactEmailQuery(value: string) {
  const trimmed = normalizedEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : "";
}

function nameForEmail(result: PeopleSearchResult, email: string) {
  const participant = result.participants.find((row) => normalizedEmail(row.email) === email);
  if (participant) return participantName(participant);
  if (normalizedEmail(result.primaryContactEmail) === email) return formatProperDisplay(result.primaryContactName) || result.primaryContactEmail;
  if (normalizedEmail(result.billingContactEmail) === email) return formatProperDisplay(result.billingContactName ?? "") || result.billingContactEmail || email;
  return email;
}

function accountName(result: PeopleSearchResult) {
  return formatProperDisplay(result.organization.name) || "No account";
}

function groupSearchResults(results: PeopleSearchResult[], query: string): PeopleSearchGroup[] {
  const emailQuery = exactEmailQuery(query);
  const groups = new Map<string, PeopleSearchGroup>();

  for (const result of results) {
    const matchingEmail = emailQuery && resultEmails(result).includes(emailQuery) ? emailQuery : "";
    const key = matchingEmail ? `email:${matchingEmail}` : `registration:${result.id}`;
    const existing = groups.get(key);

    if (existing) {
      existing.registrations.push(result);
      existing.matchTypes = Array.from(new Set([...existing.matchTypes, ...result.matchTypes]));
      continue;
    }

    groups.set(key, {
      key,
      primaryEmail: matchingEmail || result.primaryContactEmail,
      displayName: matchingEmail ? nameForEmail(result, matchingEmail) : accountName(result),
      matchTypes: result.matchTypes,
      registrations: [result]
    });
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    registrations: group.registrations.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }));
}

function GlobalPeopleSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PeopleSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      setError("");
      return;
    }

    let cancelled = false;
    setLoading(true);

    const timeout = window.setTimeout(() => {
      const searchLimit = exactEmailQuery(trimmed) ? 25 : 8;
      adminApi<{ results: PeopleSearchResult[] }>(`/api/search/people?q=${encodeURIComponent(trimmed)}&limit=${searchLimit}`)
        .then((payload) => {
          if (cancelled) return;
          setResults(payload.results ?? []);
          setError("");
          setOpen(true);
        })
        .catch((searchError) => {
          if (cancelled) return;
          setResults([]);
          setError(searchError instanceof Error ? searchError.message : "Search failed");
          setOpen(true);
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
          }
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [query]);

  function closeSearch() {
    setOpen(false);
  }

  const showPanel = open && query.trim().length >= 2;
  const groupedResults = useMemo(() => groupSearchResults(results, query), [results, query]);

  return (
    <div className="global-people-search">
      <label className="global-people-search-field">
        <SearchOutlined />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              closeSearch();
            }
          }}
          placeholder="Search email, person, invoice..."
          aria-label="Search people, registrations, invoices, and cohorts"
        />
      </label>
      {showPanel && (
        <div className="global-people-search-panel">
          <div className="global-people-search-summary">
            <strong>{loading ? "Searching..." : `${groupedResults.length} result${groupedResults.length === 1 ? "" : "s"}`}</strong>
            <button type="button" onClick={closeSearch}>Close</button>
          </div>
          {error ? <p className="global-people-search-empty">{error}</p> : null}
          {!loading && !error && groupedResults.length === 0 ? (
            <p className="global-people-search-empty">No registration, participant, POC, invoice, or PO matches.</p>
          ) : null}
          <div className="global-people-search-results">
            {groupedResults.map((group) => {
              const result = group.registrations[0]!;
              const invoice = result.invoiceDrafts[0];
              const participants = result.participants.slice(0, 4);
              const hasMultipleRegistrations = group.registrations.length > 1;

              return (
                <article className="global-people-search-card" key={group.key}>
                  <div className="global-people-search-card-header">
                    <div>
                      <strong>{group.displayName}</strong>
                      <span>
                        {group.primaryEmail}
                        {hasMultipleRegistrations ? ` · ${group.registrations.length} registrations` : ` · ${result.cohort.shortName || result.cohort.slug} · ${formatStatusLabel(result.cohort.status)}`}
                      </span>
                      <span>Account: {accountName(result)}</span>
                    </div>
                    <div className="global-people-search-tags">
                      {group.matchTypes.map((match) => <span key={match}>{match}</span>)}
                      {hasMultipleRegistrations ? <span>History</span> : null}
                    </div>
                  </div>
                  {hasMultipleRegistrations ? (
                    <div className="global-people-search-registration-list">
                      {group.registrations.map((registration) => {
                        const registrationInvoice = registration.invoiceDrafts[0];

                        return (
                          <div className="global-people-search-registration-row" key={registration.id}>
                            <div>
                              <strong>{registration.cohort.shortName || registration.cohort.slug}</strong>
                              <span>Account: {accountName(registration)} · {formatShortDate(registration.createdAt)}</span>
                            </div>
                            <div>
                              <span>{formatStatusLabel(registration.status)} · {formatStatusLabel(registration.paymentStatus)} · {formatCurrency(registration.totalAmount)}</span>
                              <span>Invoice {registrationInvoice?.invoiceNumber ?? registration.invoiceNumber ?? "-"}</span>
                            </div>
                            <Link href={registration.links.registration as Route} onClick={closeSearch}>Open</Link>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <>
                      <div className="global-people-search-meta">
                        <span>Account: {accountName(result)}</span>
                        <span>POC: {formatProperDisplay(result.primaryContactName)} · {result.primaryContactEmail}</span>
                        <span>Registered: {formatShortDate(result.createdAt)}</span>
                        <span>Registration: {formatStatusLabel(result.status)} · Roster {formatStatusLabel(result.participantListStatus)}</span>
                        <span>Payment: {formatStatusLabel(result.paymentStatus)} · {formatCurrency(result.totalAmount)}</span>
                        <span>Invoice: {invoice?.invoiceNumber ?? result.invoiceNumber ?? "-"} · {invoice ? formatStatusLabel(invoice.status) : "No draft"}{invoice?.quickBooksInvoiceRef ? " · QBO linked" : ""}</span>
                        <span>PO: {invoice?.purchaseOrderNumber ?? result.purchaseOrderNumber ?? "-"}</span>
                      </div>
                      {participants.length > 0 && (
                        <div className="global-people-search-team">
                          {participants.map((participant) => (
                            <span key={participant.id}>{participantName(participant)} · {participant.email}</span>
                          ))}
                          {result.participants.length > participants.length && <span>+{result.participants.length - participants.length} more</span>}
                        </div>
                      )}
                    </>
                  )}
                  <div className="global-people-search-actions">
                    <Link href={result.links.registration as Route} onClick={closeSearch}>Open registration</Link>
                    <Link href={result.links.cohort as Route} onClick={closeSearch}>Open cohort</Link>
                    <Link href={result.links.communications as Route} onClick={closeSearch}>Email history</Link>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
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
  const [environment, setEnvironment] = useState<AppEnvironment>({
    kind: "local",
    label: "Local",
    vercelEnvironment: "local",
    backgroundJobsAllowed: false
  });
  const title = titleFromPath(pathname);
  const subtitle = subtitleFromPath(pathname);
  const crumbs = useMemo(() => breadcrumbsFor(pathname, breadcrumbLabels), [breadcrumbLabels, pathname]);

  useEffect(() => {
    if (pathname === "/login" || pathname.startsWith("/reports/share/")) return;

    adminApi<{ environment?: AppEnvironment }>("/api/app-version")
      .then((payload) => {
        if (payload.environment) {
          setEnvironment(payload.environment);
        }
      })
      .catch(() => undefined);

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
          <p className="app-brand-title">Mission Cohort</p>
          <p className="app-brand-subtitle">Internal Ops</p>
          <span className={`app-environment-badge is-${environment.kind}`}>
            {environment.label}
          </span>
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
            {subtitle ? (
              <p className="app-topbar-subtitle">{subtitle}</p>
            ) : (
              <div className="app-breadcrumbs">
                {crumbs.map((crumb, index) => (
                  <span key={`${crumb}-${index}`}>{index > 0 ? `/ ${crumb}` : crumb}</span>
                ))}
              </div>
            )}
          </div>
          <div className={`app-environment-chip is-${environment.kind}`} title={`${environment.label} environment. Background jobs ${environment.backgroundJobsAllowed ? "enabled" : "disabled"}.`}>
            <strong>{environment.label}</strong>
            <span>
              {environment.outbound?.locked
                ? "Outbound locked"
                : environment.kind === "production"
                  ? "Live data"
                  : environment.backgroundJobsAllowed
                    ? "Test jobs on"
                    : "Jobs off"}
            </span>
          </div>
          <GlobalPeopleSearch />
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
