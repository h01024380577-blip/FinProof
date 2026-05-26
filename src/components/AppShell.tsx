"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Bell,
  ChevronRight,
  ClipboardList,
  History,
  PlusSquare,
  Settings,
  ShieldCheck,
  UserCircle
} from "lucide-react";
import { RoleSwitcher } from "./RoleSwitcher";
import { ErrorBoundary } from "./ErrorBoundary";

const navigation = [
  {
    href: "/reviews/new",
    label: "신규 요청",
    icon: PlusSquare
  },
  {
    href: "/reviews",
    label: "심의 큐",
    icon: ClipboardList
  },
  {
    href: "/reviews?scope=history",
    label: "심의 이력",
    icon: History
  }
];

function getBreadcrumb(pathname: string): string[] {
  if (pathname.startsWith("/reviews/new")) {
    return ["심의 큐", "신규 심의 요청"];
  }

  if (pathname.startsWith("/reviews/")) {
    const reviewId = decodeURIComponent(pathname.split("/").filter(Boolean).at(-1) ?? "심의 상세");

    return ["심의 큐", reviewId];
  }

  return ["FinProof Agent", "심의 큐"];
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const scope = searchParams.get("scope");
  const breadcrumb = getBreadcrumb(pathname);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand brand--wordmark" href="/reviews" aria-label="FinProof home">
          <span className="brand__mark" aria-hidden="true">
            <ShieldCheck size={20} />
          </span>
          <span>
            <strong>FinProof</strong>
          </span>
        </Link>

        <nav className="sidebar__nav" aria-label="Primary navigation">
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/reviews"
                ? pathname === "/reviews" && scope !== "history"
                : item.href === "/reviews?scope=history"
                  ? pathname === "/reviews" && scope === "history"
                  : item.href === "/reviews/new" && pathname.startsWith("/reviews/new");

            return (
              <Link key={item.href} className="nav-link" data-active={isActive} href={item.href}>
                <Icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <nav className="breadcrumb" aria-label="Breadcrumb">
            {breadcrumb.map((item, index) => (
              <span key={`${item}-${index}`}>
                {index > 0 ? <ChevronRight size={15} aria-hidden="true" /> : null}
                <span>{item}</span>
              </span>
            ))}
          </nav>
          <div className="topbar__actions">
            <button className="topbar__icon-button" type="button" aria-label="알림" title="알림">
              <Bell size={19} aria-hidden="true" />
            </button>
            <button className="topbar__icon-button" type="button" aria-label="설정" title="설정">
              <Settings size={19} aria-hidden="true" />
            </button>
            <button
              className="topbar__avatar"
              type="button"
              aria-label="사용자 메뉴"
              title="사용자 메뉴"
            >
              <UserCircle size={21} aria-hidden="true" />
            </button>
            <div className="topbar__role">
              <RoleSwitcher />
            </div>
          </div>
        </header>
        <div className="workspace__content">
          <ErrorBoundary>{children}</ErrorBoundary>
        </div>
      </div>
    </div>
  );
}
