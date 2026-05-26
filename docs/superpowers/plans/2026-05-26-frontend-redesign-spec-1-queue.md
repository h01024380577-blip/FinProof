# Spec 1 — Review Queue Refinement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine `/reviews` queue to use KPI cards, FilterBar, reordered table, KPI-click-to-filter, full-row navigation, and keyboard shortcuts — by extracting `ReviewQueue.tsx` into `queue/*` submodules.

**Architecture:** `ReviewQueue.tsx` becomes a thin container that owns data fetching and filter state, delegating presentation to `QueueMetrics`, `QueueFilters`, `QueueTable`. All three use the Spec 0 primitives.

**Tech Stack:** Next.js 16 App Router, React 19 hooks, TypeScript, lucide-react.

**Depends on:** Spec 0 (`@/components/ui` + tokens) must be merged.

**Source spec:** `docs/superpowers/specs/2026-05-26-frontend-stitch-redesign-design.md` § Spec 1 + Review Queue section.

---

### Task 1: Extract `QueueMetrics` using `KpiCard`

**Files:**
- Create: `src/components/queue/QueueMetrics.tsx`
- Create: `src/components/queue/QueueMetrics.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/components/queue/QueueMetrics.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueueMetrics } from "./QueueMetrics";

describe("QueueMetrics", () => {
  const metrics = {
    analysisWaiting: 7,
    inReview: 4,
    rejectRecommended: 2,
    dueSoon: 1
  };

  it("renders four KPI cards with values", () => {
    render(<QueueMetrics metrics={metrics} />);
    expect(screen.getByText("분석 대기")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("반려 권고")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("invokes click handlers when KPI cards are clickable", async () => {
    const onSelectRisk = vi.fn();
    const onSelectDueSoon = vi.fn();
    render(
      <QueueMetrics
        metrics={metrics}
        onSelectRejectRecommended={onSelectRisk}
        onSelectDueSoon={onSelectDueSoon}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /반려 권고/ }));
    expect(onSelectRisk).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: /마감 임박/ }));
    expect(onSelectDueSoon).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npm run test -- QueueMetrics`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/components/queue/QueueMetrics.tsx`:

```tsx
"use client";

import { KpiCard } from "@/components/ui";

export type QueueMetricValues = {
  analysisWaiting: number;
  inReview: number;
  rejectRecommended: number;
  dueSoon: number;
};

export type QueueMetricsProps = {
  metrics: QueueMetricValues;
  onSelectRejectRecommended?: () => void;
  onSelectDueSoon?: () => void;
};

export function QueueMetrics({
  metrics,
  onSelectRejectRecommended,
  onSelectDueSoon
}: QueueMetricsProps): JSX.Element {
  return (
    <section className="queue-metrics" aria-label="Review queue metrics">
      <KpiCard label="분석 대기" value={metrics.analysisWaiting} tone="primary" />
      <KpiCard label="검토 중" value={metrics.inReview} tone="primary" />
      <KpiCard
        label="반려 권고"
        value={metrics.rejectRecommended}
        tone="danger"
        onClick={onSelectRejectRecommended}
      />
      <KpiCard
        label="마감 임박"
        value={metrics.dueSoon}
        tone="warning"
        onClick={onSelectDueSoon}
      />
    </section>
  );
}
```

- [ ] **Step 4: Add CSS**

Append to `src/app/globals.css`:

```css
.queue-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(180px, 1fr));
  gap: var(--space-4);
  margin-bottom: var(--space-6);
}
```

- [ ] **Step 5: Run tests**

Run: `npm run test -- QueueMetrics`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/queue/QueueMetrics.tsx src/components/queue/QueueMetrics.test.tsx src/app/globals.css
git commit -m "feat(queue): add QueueMetrics with KPI cards"
```

---

### Task 2: Extract `QueueFilters` using `FilterBar`

**Files:**
- Create: `src/components/queue/QueueFilters.tsx`
- Create: `src/components/queue/QueueFilters.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/components/queue/QueueFilters.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueueFilters, type QueueFilterState } from "./QueueFilters";

const state: QueueFilterState = {
  search: "",
  status: "all",
  risk: "all",
  product: "all"
};

describe("QueueFilters", () => {
  it("renders search, status, risk, product filters", () => {
    render(<QueueFilters state={state} onChange={() => undefined} onReset={() => undefined} />);
    expect(screen.getByPlaceholderText(/검색/)).toBeInTheDocument();
    expect(screen.getByLabelText(/상태/)).toBeInTheDocument();
    expect(screen.getByLabelText(/위험도/)).toBeInTheDocument();
    expect(screen.getByLabelText(/상품군/)).toBeInTheDocument();
  });

  it("fires onChange when a select value changes", async () => {
    const onChange = vi.fn();
    render(<QueueFilters state={state} onChange={onChange} onReset={() => undefined} />);
    await userEvent.selectOptions(screen.getByLabelText(/상태/), "analysis_waiting");
    expect(onChange).toHaveBeenCalledWith({ ...state, status: "analysis_waiting" });
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npm run test -- QueueFilters`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/components/queue/QueueFilters.tsx`:

```tsx
"use client";

import { FilterBar, type FilterGroup } from "@/components/ui";
import type { ProductType, ReviewCase, RiskLevel } from "@/domain/types";

export type QueueFilterState = {
  search: string;
  status: ReviewCase["status"] | "all";
  risk: RiskLevel | "all" | "analysis_pending";
  product: ProductType | "all";
};

export type QueueFiltersProps = {
  state: QueueFilterState;
  onChange: (next: QueueFilterState) => void;
  onReset: () => void;
};

const statusOptions = [
  { value: "all", label: "상태: 전체" },
  { value: "analysis_waiting", label: "분석 대기" },
  { value: "analysis_complete", label: "분석 완료" },
  { value: "under_review", label: "검토 중" },
  { value: "change_requested", label: "수정 요청" },
  { value: "approved", label: "승인" },
  { value: "rejected", label: "반려" }
];

const riskOptions = [
  { value: "all", label: "위험도: 전체" },
  { value: "reject_recommended", label: "반려 권고" },
  { value: "high", label: "위험" },
  { value: "caution", label: "주의" },
  { value: "info", label: "참고" },
  { value: "analysis_pending", label: "분석 전" }
];

const productOptions = [
  { value: "all", label: "상품군: 전체" },
  { value: "deposit", label: "예금/적금" },
  { value: "loan", label: "대출" },
  { value: "card", label: "카드" },
  { value: "capital", label: "캐피탈" },
  { value: "insurance", label: "보험" },
  { value: "investment", label: "투자상품" }
];

export function QueueFilters({ state, onChange, onReset }: QueueFiltersProps): JSX.Element {
  const groups: FilterGroup[] = [
    { key: "status", label: "상태", value: state.status, defaultValue: "all", options: statusOptions },
    { key: "risk", label: "위험도", value: state.risk, defaultValue: "all", options: riskOptions },
    { key: "product", label: "상품군", value: state.product, defaultValue: "all", options: productOptions }
  ];

  return (
    <FilterBar
      searchValue={state.search}
      searchPlaceholder="심의 ID, 제목, 담당자 검색"
      onSearchChange={(value) => onChange({ ...state, search: value })}
      groups={groups}
      onGroupChange={(key, value) => onChange({ ...state, [key]: value } as QueueFilterState)}
      onReset={onReset}
    />
  );
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test -- QueueFilters`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/queue/QueueFilters.tsx src/components/queue/QueueFilters.test.tsx
git commit -m "feat(queue): add QueueFilters using FilterBar"
```

---

### Task 3: Extract `QueueTable`

**Files:**
- Create: `src/components/queue/QueueTable.tsx`
- Create: `src/components/queue/QueueTable.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/components/queue/QueueTable.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueueTable } from "./QueueTable";
import type { ReviewSummary } from "@/domain/types";

const baseRow: ReviewSummary = {
  id: "RC-2026-001",
  title: "최고 연 5.0% 적금 홍보물 심의",
  affiliate: "광주은행",
  productType: "deposit",
  plannedPublishDate: "2026-06-10",
  status: "analysis_waiting",
  highestRiskLevel: "info",
  requester: "김요청",
  reviewer: "박심의"
};

describe("QueueTable", () => {
  it("renders header and rows", () => {
    render(
      <QueueTable
        rows={[baseRow]}
        activeRole="reviewer"
        activeAnalysisId={null}
        onStartAnalysis={() => undefined}
        onOpenReview={() => undefined}
      />
    );
    expect(screen.getByText("심의 ID")).toBeInTheDocument();
    expect(screen.getByText("RC-2026-001")).toBeInTheDocument();
  });

  it("fires onStartAnalysis when reviewer clicks start button on analysis_waiting row", async () => {
    const onStart = vi.fn();
    render(
      <QueueTable
        rows={[baseRow]}
        activeRole="reviewer"
        activeAnalysisId={null}
        onStartAnalysis={onStart}
        onOpenReview={() => undefined}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /AI 분석 시작/ }));
    expect(onStart).toHaveBeenCalledWith(baseRow);
  });

  it("navigates via row click when case is openable", async () => {
    const onOpen = vi.fn();
    render(
      <QueueTable
        rows={[{ ...baseRow, status: "analysis_complete" }]}
        activeRole="reviewer"
        activeAnalysisId={null}
        onStartAnalysis={() => undefined}
        onOpenReview={onOpen}
      />
    );
    await userEvent.click(screen.getByRole("row", { name: /최고 연 5.0%/ }));
    expect(onOpen).toHaveBeenCalledWith("RC-2026-001");
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npm run test -- QueueTable`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/components/queue/QueueTable.tsx`:

```tsx
"use client";

import { Loader2, PlayCircle } from "lucide-react";
import { RiskBadge, StatusBadge } from "@/components/Badges";
import { statusLabels } from "@/domain/reviews";
import type {
  ProductType,
  ReviewAction,
  ReviewCase,
  ReviewSummary,
  RoleId
} from "@/domain/types";

const productLabels: Record<ProductType, string> = {
  deposit: "예금/적금",
  loan: "대출",
  card: "카드",
  capital: "캐피탈",
  insurance: "보험",
  investment: "투자상품"
};

function isAnalysisWaiting(status: ReviewCase["status"]): boolean {
  return status === "submitted" || status === "analysis_waiting";
}

function canOpenWorkbench(status: ReviewCase["status"]): boolean {
  return (
    status === "analysis_complete" ||
    status === "under_review" ||
    status === "change_requested" ||
    status === "rejected" ||
    status === "approved" ||
    status === "on_hold"
  );
}

function fallbackActionsFor(role: RoleId, status: ReviewCase["status"]): ReviewAction[] {
  if (status === "analysis_waiting" && (role === "reviewer" || role === "compliance_admin")) {
    return ["start_analysis"];
  }
  if (canOpenWorkbench(status)) {
    return status === "analysis_complete" ? ["open_workbench", "view_audit"] : ["view_audit"];
  }
  return [];
}

function actionsFor(review: ReviewSummary, role: RoleId): ReviewAction[] {
  return review.availableActions ?? fallbackActionsFor(role, review.status);
}

function requestDepartment(review: ReviewSummary): string {
  if (review.requester.includes("업로드")) return "디지털마케팅팀";
  if (review.productType === "card") return "제휴마케팅팀";
  if (review.productType === "loan") return "리테일금융팀";
  return "마케팅팀";
}

export type QueueTableProps = {
  rows: ReviewSummary[];
  activeRole: RoleId;
  activeAnalysisId: string | null;
  isLoading?: boolean;
  emptyMessage?: string;
  onStartAnalysis: (review: ReviewSummary) => void;
  onOpenReview: (reviewId: string) => void;
};

export function QueueTable({
  rows,
  activeRole,
  activeAnalysisId,
  isLoading = false,
  emptyMessage,
  onStartAnalysis,
  onOpenReview
}: QueueTableProps): JSX.Element {
  return (
    <div className="review-table review-table--queue" role="table" aria-label="Review cases">
      <div className="review-table__row review-table__row--head" role="row">
        <span role="columnheader">심의 ID</span>
        <span role="columnheader">제목</span>
        <span role="columnheader">상품군</span>
        <span role="columnheader">요청 부서</span>
        <span role="columnheader">상태</span>
        <span role="columnheader">위험도</span>
        <span role="columnheader">마감일</span>
        <span role="columnheader">담당자</span>
        <span role="columnheader">작업</span>
      </div>

      {isLoading ? (
        <div className="queue-empty-state">
          <Loader2 size={18} aria-hidden="true" /> 심의 큐를 불러오는 중입니다.
        </div>
      ) : null}

      {!isLoading && rows.length === 0 ? (
        <div className="queue-empty-state">{emptyMessage ?? "아직 심의 요청이 없습니다."}</div>
      ) : null}

      {rows.map((review) => {
        const waiting = isAnalysisWaiting(review.status);
        const rowActions = actionsFor(review, activeRole);
        const canStart = rowActions.includes("start_analysis");
        const canOpen = rowActions.includes("open_workbench");
        const canViewAudit = rowActions.includes("view_audit");
        const openable = canOpen || canViewAudit;

        return (
          <div
            key={review.id}
            className="review-table__row"
            role="row"
            tabIndex={openable ? 0 : -1}
            aria-label={`${review.title}`}
            data-clickable={openable}
            onClick={() => openable && onOpenReview(review.id)}
            onKeyDown={(event) => {
              if (openable && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                onOpenReview(review.id);
              }
            }}
          >
            <span className="queue-id" role="cell">{review.id}</span>
            <strong role="cell">{review.title}</strong>
            <span role="cell">{productLabels[review.productType]}</span>
            <span role="cell">{requestDepartment(review)}</span>
            <span role="cell"><StatusBadge status={review.status} /></span>
            <span role="cell">
              {waiting || review.status === "analysis_queued" ? (
                <span className="risk-badge risk-badge--muted">분석 전</span>
              ) : (
                <RiskBadge level={review.highestRiskLevel} />
              )}
            </span>
            <span role="cell">{review.plannedPublishDate}</span>
            <span role="cell">{review.reviewer}</span>
            <span className="queue-row-actions" role="cell" onClick={(event) => event.stopPropagation()}>
              {waiting ? (
                <button
                  className="button button--small"
                  type="button"
                  disabled={!canStart || activeAnalysisId === review.id}
                  onClick={() => onStartAnalysis(review)}
                >
                  <PlayCircle size={15} aria-hidden="true" />
                  {activeAnalysisId === review.id ? "시작 중" : "AI 분석 시작"}
                </button>
              ) : null}
              {!waiting && !openable ? (
                <span className="queue-row-note">{statusLabels[review.status]}</span>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Update CSS for clickable rows**

Append to `src/app/globals.css`:

```css
.review-table__row[data-clickable="true"] { cursor: pointer; }
.review-table__row[data-clickable="true"]:hover { background: var(--surface-muted); }
.queue-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); font-size: var(--font-size-xs); }
```

- [ ] **Step 5: Run tests**

Run: `npm run test -- QueueTable`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/queue/QueueTable.tsx src/components/queue/QueueTable.test.tsx src/app/globals.css
git commit -m "feat(queue): add QueueTable with full-row navigation"
```

---

### Task 4: Refactor `ReviewQueue` to compose submodules

**Files:**
- Modify: `src/components/ReviewQueue.tsx`
- Modify: `src/components/ReviewQueue.test.tsx` (selectors only if needed)

- [ ] **Step 1: Rewrite `ReviewQueue.tsx` to use queue submodules**

Replace entire file with:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import type {
  ProductType,
  ReviewCase,
  ReviewSummary,
  RiskLevel
} from "@/domain/types";
import { QueueMetrics, type QueueMetricValues } from "./queue/QueueMetrics";
import { QueueFilters, type QueueFilterState } from "./queue/QueueFilters";
import { QueueTable } from "./queue/QueueTable";
import { useRole } from "./RoleContext";

type ReviewCasesResponse = { reviewCases: ReviewSummary[] };
type AnalysisStartResponse = {
  reviewCaseId: string;
  status: ReviewCase["status"];
  analysisHref: string;
};

function isAnalysisWaiting(status: ReviewCase["status"]): boolean {
  return status === "submitted" || status === "analysis_waiting";
}

function fallbackActionsFor(
  role: ReturnType<typeof useRole>["activeRole"],
  status: ReviewCase["status"]
) {
  if (status === "analysis_waiting" && (role === "reviewer" || role === "compliance_admin")) {
    return ["start_analysis" as const];
  }
  if (
    status === "analysis_complete" ||
    status === "under_review" ||
    status === "change_requested" ||
    status === "rejected" ||
    status === "approved" ||
    status === "on_hold"
  ) {
    return status === "analysis_complete"
      ? (["open_workbench", "view_audit"] as const)
      : (["view_audit"] as const);
  }
  return [];
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase("ko-KR");
}

const defaultFilterState: QueueFilterState = {
  search: "",
  status: "all",
  risk: "all",
  product: "all"
};

export function ReviewQueue(): JSX.Element {
  const { activeRole } = useRole();
  const router = useRouter();
  const [reviews, setReviews] = useState<ReviewSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeAnalysisId, setActiveAnalysisId] = useState<string | null>(null);
  const [filters, setFilters] = useState<QueueFilterState>(defaultFilterState);

  const metrics: QueueMetricValues = useMemo(
    () => ({
      analysisWaiting: reviews.filter((r) => isAnalysisWaiting(r.status)).length,
      inReview: reviews.filter(
        (r) => r.status === "analysis_complete" || r.status === "under_review"
      ).length,
      rejectRecommended: reviews.filter((r) => r.highestRiskLevel === "reject_recommended").length,
      dueSoon: reviews.filter((r) => r.plannedPublishDate <= "2026-06-12").length
    }),
    [reviews]
  );

  const filtered = useMemo(() => {
    const q = normalizeSearch(filters.search);
    return reviews.filter((review) => {
      const waiting = isAnalysisWaiting(review.status);
      const matchesQ =
        q.length === 0 ||
        [review.id, review.title, review.affiliate, review.requester, review.reviewer]
          .join(" ")
          .toLocaleLowerCase("ko-KR")
          .includes(q);
      const matchesStatus = filters.status === "all" || review.status === filters.status;
      const matchesRisk =
        filters.risk === "all" ||
        (filters.risk === "analysis_pending"
          ? waiting
          : review.highestRiskLevel === filters.risk);
      const matchesProduct =
        filters.product === "all" || review.productType === filters.product;
      return matchesQ && matchesStatus && matchesRisk && matchesProduct;
    });
  }, [filters, reviews]);

  useEffect(() => {
    let mounted = true;
    setIsLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const response = await fetch("/api/v1/review-cases", {
          headers: { "x-finproof-role": activeRole }
        });
        if (!response.ok) throw new Error("심의 큐를 불러오지 못했습니다.");
        const body = (await response.json()) as ReviewCasesResponse;
        if (mounted) setReviews(body.reviewCases);
      } catch (error) {
        if (mounted)
          setLoadError(error instanceof Error ? error.message : "심의 큐를 불러오지 못했습니다.");
      } finally {
        if (mounted) setIsLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [activeRole]);

  async function startAnalysis(review: ReviewSummary): Promise<void> {
    setActiveAnalysisId(review.id);
    setLoadError(null);
    try {
      const response = await fetch(`/api/v1/review-cases/${review.id}/analysis/start`, {
        method: "POST",
        headers: { "x-finproof-role": activeRole }
      });
      if (!response.ok) throw new Error("분석 시작 권한 또는 요청을 확인해 주세요.");
      const body = (await response.json()) as AnalysisStartResponse;
      setReviews((current) =>
        current.map((candidate) =>
          candidate.id === review.id
            ? {
                ...candidate,
                status: body.status,
                availableActions: fallbackActionsFor(activeRole, body.status) as unknown as ReviewSummary["availableActions"]
              }
            : candidate
        )
      );
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "분석 시작 요청을 처리하지 못했습니다."
      );
    } finally {
      setActiveAnalysisId(null);
    }
  }

  return (
    <div className="review-queue">
      <section className="queue-head">
        <div>
          <h2>심의 큐</h2>
          <p>업로드된 심의 요청을 확인하고 분석 대기 건을 배정합니다.</p>
        </div>
        <Link className="button button--primary" href="/reviews/new">
          <FilePlus2 size={16} aria-hidden="true" />새 심의 요청
        </Link>
      </section>

      <QueueMetrics
        metrics={metrics}
        onSelectRejectRecommended={() => setFilters((f) => ({ ...f, risk: "reject_recommended" }))}
        onSelectDueSoon={() => setFilters((f) => ({ ...f, status: "all", risk: "all" }))}
      />

      <section className="queue-panel">
        <QueueFilters
          state={filters}
          onChange={setFilters}
          onReset={() => setFilters(defaultFilterState)}
        />

        {loadError ? (
          <p className="interaction-error" role="alert">
            {loadError}
          </p>
        ) : null}

        <QueueTable
          rows={filtered}
          activeRole={activeRole}
          activeAnalysisId={activeAnalysisId}
          isLoading={isLoading}
          emptyMessage={
            reviews.length > 0
              ? "검색 또는 필터 조건에 맞는 심의 건이 없습니다."
              : "아직 심의 요청이 없습니다. 새 심의 요청을 생성해 자료 패키지를 업로드하세요."
          }
          onStartAnalysis={(review) => void startAnalysis(review)}
          onOpenReview={(id) => router.push(`/reviews/${id}`)}
        />
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Run existing ReviewQueue tests**

Run: `npm run test -- ReviewQueue`
Expected: PASS — selectors should still resolve. If any selector fails because old markup is gone, update it minimally in `ReviewQueue.test.tsx` to use the new queue/* structure.

- [ ] **Step 3: Full quality gate**

Run: `npm run lint && npm run test && npm run build`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/components/ReviewQueue.tsx src/components/ReviewQueue.test.tsx
git commit -m "refactor(queue): compose ReviewQueue from queue/* submodules"
```

---

### Task 5: Keyboard shortcut — `/` focuses search

**Files:**
- Modify: `src/components/ReviewQueue.tsx`

- [ ] **Step 1: Add global `/` key handler**

In `ReviewQueue.tsx`, add a `useEffect` that listens for the `/` key and focuses the search input. Identify the search input by `aria-label="검색"`.

Insert after the `useEffect` for loading reviews:

```tsx
useEffect(() => {
  function onKey(event: KeyboardEvent): void {
    if (event.key === "/" && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) {
      const input = document.querySelector<HTMLInputElement>('input[aria-label="검색"]');
      if (input) {
        event.preventDefault();
        input.focus();
      }
    }
  }
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, []);
```

- [ ] **Step 2: Verify lint/test/build**

Run: `npm run lint && npm run test && npm run build`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add src/components/ReviewQueue.tsx
git commit -m "feat(queue): add / keyboard shortcut to focus search"
```

---

### Task 6: Final dev-server smoke check

- [ ] **Step 1: Start dev server**

Run in background: `npm run dev`
Then `curl -sf http://localhost:3000/reviews -o /dev/null` and confirm exit 0.

- [ ] **Step 2: Stop dev server**

Kill the background dev server.

- [ ] **Step 3: Summary commit (if any pending tweaks)**

If no further changes needed, skip. Otherwise stage + commit with `chore(queue): final polish`.

---

## Self-Review

- ✅ Spec § Review Queue → KPI cards (Task 1), filter bar (Task 2), reordered columns + full-row click (Task 3), keyboard shortcut (Task 5).
- ✅ Spec § Quality gates → covered in Tasks 4–6.
- ✅ Type names consistent: `QueueMetricValues`, `QueueFilterState`.
- ✅ No placeholders; all code blocks complete.
- ✅ Test selectors updated alongside markup changes.
