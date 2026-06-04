"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  BookOpenCheck,
  ChevronRight,
  ClipboardList,
  History,
  PlusSquare,
  Radar,
  Settings,
  type LucideIcon
} from "lucide-react";
import type { RoleId } from "@/domain/types";
import { RoleSwitcher } from "./RoleSwitcher";
import { useRoleContext } from "./RoleContext";
import { ErrorBoundary } from "./ErrorBoundary";
import { FinProofMark } from "./FinProofMark";
import { NotificationCenter } from "./NotificationCenter";

type NavigationItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: RoleId[];
};

const navigation: NavigationItem[] = [
  {
    href: "/reviews/new",
    label: "신규 요청",
    icon: PlusSquare,
    roles: ["requester"]
  },
  {
    href: "/reviews/history",
    label: "요청 기록",
    icon: History,
    roles: ["requester"]
  },
  {
    href: "/reviews",
    label: "심의 대기 목록",
    icon: ClipboardList,
    roles: ["reviewer", "compliance_admin"]
  },
  {
    href: "/reviews?scope=history",
    label: "심의 이력",
    icon: History,
    roles: ["reviewer", "compliance_admin"]
  },
  {
    href: "/knowledge-documents",
    label: "지식문서 등록",
    icon: BookOpenCheck,
    roles: ["reviewer", "compliance_admin"]
  },
  {
    href: "/regulatory-sources",
    label: "규제 변경",
    icon: Radar,
    roles: ["reviewer", "compliance_admin"]
  }
];

function defaultHrefForRole(role: RoleId): string {
  return role === "requester" ? "/reviews/new" : "/reviews";
}

function matchesRouteSegment(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

function canAccessPath(pathname: string, role: RoleId): boolean {
  if (pathname === "/") {
    return true;
  }

  if (role === "requester") {
    return (
      matchesRouteSegment(pathname, "/reviews/new") ||
      matchesRouteSegment(pathname, "/reviews/history") ||
      pathname.startsWith("/reviews/")
    );
  }

  if (
    matchesRouteSegment(pathname, "/reviews/new") ||
    matchesRouteSegment(pathname, "/reviews/history")
  ) {
    return false;
  }

  return (
    pathname.startsWith("/reviews") ||
    pathname.startsWith("/knowledge-documents") ||
    pathname.startsWith("/regulatory-sources")
  );
}

function getBreadcrumb(pathname: string): string[] {
  if (matchesRouteSegment(pathname, "/reviews/new")) {
    return ["신규 요청", "신규 심의 요청"];
  }

  if (matchesRouteSegment(pathname, "/reviews/history")) {
    return ["요청 기록", "내 요청 기록"];
  }

  if (pathname.startsWith("/knowledge-documents")) {
    return ["기준 관리", "지식문서 등록"];
  }

  if (pathname.startsWith("/regulatory-sources")) {
    return ["기준 관리", "규제 변경"];
  }

  if (pathname.startsWith("/reviews/")) {
    const reviewId = decodeURIComponent(pathname.split("/").filter(Boolean).at(-1) ?? "심의 상세");

    return ["심의 대기 목록", reviewId];
  }

  return ["FinProof Agent", "심의 대기 목록"];
}

function subscribeToHydration() {
  return () => {};
}

function getHydratedSnapshot() {
  return true;
}

function getServerHydrationSnapshot() {
  return false;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const roleContext = useRoleContext();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const scope = searchParams.get("scope");
  const hasMounted = useSyncExternalStore(
    subscribeToHydration,
    getHydratedSnapshot,
    getServerHydrationSnapshot
  );
  const canUseSession = hasMounted && (roleContext?.isSessionReady ?? false);
  const activeRole = canUseSession ? (roleContext?.activeRole ?? "reviewer") : "reviewer";
  const isAuthenticated = canUseSession ? (roleContext?.isAuthenticated ?? false) : false;
  const visibleNavigation = isAuthenticated
    ? navigation.filter((item) => item.roles.includes(activeRole))
    : [];
  const defaultHref = defaultHrefForRole(activeRole);
  const breadcrumb = getBreadcrumb(pathname);

  useEffect(() => {
    if (isAuthenticated && !canAccessPath(pathname, activeRole)) {
      router.replace(defaultHref);
    }
  }, [activeRole, defaultHref, isAuthenticated, pathname, router]);

  if (pathname === "/") {
    return <ErrorBoundary>{children}</ErrorBoundary>;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand brand--wordmark" href={defaultHref} aria-label="FinProof home">
          <span className="brand__mark" aria-hidden="true">
            <FinProofMark size={52} />
          </span>
          <span>
            <strong>FinProof</strong>
          </span>
        </Link>
        <nav className="sidebar__nav" aria-label="Primary navigation">
          {visibleNavigation.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/reviews"
                ? pathname === "/reviews" && scope !== "history"
                : item.href === "/reviews?scope=history"
                  ? pathname === "/reviews" && scope === "history"
                  : item.href === "/reviews/new"
                    ? matchesRouteSegment(pathname, "/reviews/new")
                    : matchesRouteSegment(pathname, item.href);

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
            <NotificationCenter />
            <button className="topbar__icon-button" type="button" aria-label="설정" title="설정">
              <Settings size={19} aria-hidden="true" />
            </button>
            <div className="topbar__role">
              {canUseSession ? (
                <RoleSwitcher />
              ) : (
                <div className="role-switcher" aria-label="Demo user session">
                  <button className="role-switcher__button" type="button">
                    로그인
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <div className="workspace__content">
          <ErrorBoundary>
            {isAuthenticated ? (
              children
            ) : (
              <section className="queue-panel auth-required-panel" aria-label="로그인 필요">
                <p className="queue-empty-state">로그인 후 FinProof Agent를 이용해 주세요.</p>
              </section>
            )}
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}
