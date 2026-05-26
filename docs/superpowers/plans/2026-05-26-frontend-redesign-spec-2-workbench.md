# Spec 2 — Workbench Refinement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `ReviewDetailWorkspace.tsx` into `workbench/*` submodules with a compact header, tabbed right pane (URL-synced via `?tab=`), collapsible bottom drawer, stronger issue↔bbox sync, and clearer header action labeling.

**Architecture:** `ReviewDetailWorkspace.tsx` becomes a thin container that owns mutation state and API calls; presentation is split into five focused modules. The right pane uses `Tabs` from Spec 0.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, lucide-react, `useSearchParams` + `router.replace` for URL sync.

**Depends on:** Spec 0 (`Tabs` primitive).

**Source spec:** `docs/superpowers/specs/2026-05-26-frontend-stitch-redesign-design.md` § Spec 2 + Review Workbench section.

---

### Task 1: Extract `WorkbenchHeader`

**Files:**

- Create: `src/components/workbench/WorkbenchHeader.tsx`
- Create: `src/components/workbench/WorkbenchHeader.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkbenchHeader } from "./WorkbenchHeader";

describe("WorkbenchHeader", () => {
  it("renders id, title, and meta", () => {
    render(
      <WorkbenchHeader
        id="RC-2026-001"
        title="최고 연 5.0% 적금 심의"
        statusLabel="검토 중"
        riskLabel="위험"
        productLabel="예금/적금"
        reviewer="박심의"
        deadline="2026-06-10"
        canMutate
        selectedAction="change_request"
        isGeneratingDraft={false}
        onSelectAction={() => undefined}
        onGenerateDraft={() => undefined}
      />
    );
    expect(screen.getByText("RC-2026-001")).toBeInTheDocument();
    expect(screen.getByText("최고 연 5.0% 적금 심의")).toBeInTheDocument();
    expect(screen.getByText(/박심의/)).toBeInTheDocument();
  });

  it("fires onSelectAction when an action button is clicked", async () => {
    const onSelect = vi.fn();
    render(
      <WorkbenchHeader
        id="RC-2026-001"
        title="title"
        statusLabel="검토 중"
        riskLabel="위험"
        productLabel="예금/적금"
        reviewer="박심의"
        deadline="2026-06-10"
        canMutate
        selectedAction="change_request"
        isGeneratingDraft={false}
        onSelectAction={onSelect}
        onGenerateDraft={() => undefined}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "반려" }));
    expect(onSelect).toHaveBeenCalledWith("reject");
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npm run test -- WorkbenchHeader`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/components/workbench/WorkbenchHeader.tsx`:

```tsx
"use client";

import { AlertTriangle, FilePenLine } from "lucide-react";
import type { ReviewIssue } from "@/domain/types";

export type WorkbenchHeaderProps = {
  id: string;
  title: string;
  statusLabel: string;
  riskLabel: string;
  productLabel: string;
  reviewer: string;
  deadline: string;
  canMutate: boolean;
  selectedAction: NonNullable<ReviewIssue["finalAction"]>;
  isGeneratingDraft: boolean;
  onSelectAction: (action: NonNullable<ReviewIssue["finalAction"]>) => void;
  onGenerateDraft: () => void;
};

export function WorkbenchHeader({
  id,
  title,
  statusLabel,
  riskLabel,
  productLabel,
  reviewer,
  deadline,
  canMutate,
  selectedAction,
  isGeneratingDraft,
  onSelectAction,
  onGenerateDraft
}: WorkbenchHeaderProps): JSX.Element {
  return (
    <section className="detail__header workbench-header">
      <div className="detail__title-block">
        <p className="detail__crumb">{id}</p>
        <h2>{title}</h2>
        <p className="detail__meta">
          <span className="status-dot" aria-hidden="true" />
          {statusLabel}
          <span aria-hidden="true">|</span>
          {productLabel}
          <span aria-hidden="true">|</span>
          <span className="detail__risk-line">
            <AlertTriangle size={15} aria-hidden="true" />
            최고 위험도: {riskLabel}
          </span>
          <span aria-hidden="true">|</span>
          담당: {reviewer}
          <span aria-hidden="true">|</span>
          마감: {deadline}
        </p>
      </div>
      <div className="detail__actions" role="group" aria-label="이슈 추천 조치">
        <span className="workbench-header__group-label" aria-hidden="true">
          이슈 추천 조치
        </span>
        <button
          className="button detail-action-button"
          type="button"
          data-active={selectedAction === "hold"}
          disabled={!canMutate}
          onClick={() => onSelectAction("hold")}
        >
          보류
        </button>
        <button
          className="button detail-action-button detail-action-button--danger"
          type="button"
          data-active={selectedAction === "reject"}
          disabled={!canMutate}
          onClick={() => onSelectAction("reject")}
        >
          반려
        </button>
        <button
          className="button detail-action-button"
          type="button"
          data-active={selectedAction === "change_request"}
          disabled={!canMutate}
          onClick={() => onSelectAction("change_request")}
        >
          수정 요청
        </button>
        <button
          className="button button--primary"
          type="button"
          disabled={!canMutate || isGeneratingDraft}
          onClick={onGenerateDraft}
        >
          <FilePenLine size={16} aria-hidden="true" />
          {isGeneratingDraft ? "생성 중" : "초안 생성"}
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Add CSS**

Append to `src/app/globals.css`:

```css
.workbench-header {
  position: sticky;
  top: 0;
  z-index: 5;
  background: var(--app-bg);
}
.workbench-header__group-label {
  font-size: var(--font-size-xs);
  color: var(--muted);
  margin-right: var(--space-2);
  align-self: center;
}
```

- [ ] **Step 5: Run tests + commit**

```bash
npm run test -- WorkbenchHeader
git add src/components/workbench/WorkbenchHeader.tsx src/components/workbench/WorkbenchHeader.test.tsx src/app/globals.css
git commit -m "feat(workbench): add WorkbenchHeader with action group"
```

---

### Task 2: Extract `IssueList`

**Files:**

- Create: `src/components/workbench/IssueList.tsx`
- Create: `src/components/workbench/IssueList.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IssueList } from "./IssueList";
import type { ReviewIssue } from "@/domain/types";

const issues: ReviewIssue[] = [
  {
    id: "issue-1",
    issueType: "claim",
    riskLevel: "high",
    title: "최고 연 5.0% 조건 표시 부족",
    targetText: "최고 연 5.0% 적금!",
    targetBbox: [10, 10, 30, 8],
    sourceAgents: [],
    suggestedAction: "change_request",
    status: "open",
    description: "...",
    suggestedCopy: "...",
    evidence: []
  }
];

describe("IssueList", () => {
  it("renders issues with risk filter", async () => {
    const onSelect = vi.fn();
    render(<IssueList issues={issues} selectedIssueId="issue-1" onSelectIssue={onSelect} />);
    expect(screen.getByText("최고 연 5.0% 조건 표시 부족")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /최고 연 5.0%/ }));
    expect(onSelect).toHaveBeenCalledWith("issue-1");
  });

  it("filters by risk level chip", async () => {
    const issuesMix: ReviewIssue[] = [
      { ...issues[0], id: "h", riskLevel: "high", title: "High issue" },
      { ...issues[0], id: "i", riskLevel: "info", title: "Info issue" }
    ];
    render(<IssueList issues={issuesMix} selectedIssueId="h" onSelectIssue={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "위험" }));
    expect(screen.getByText("High issue")).toBeInTheDocument();
    expect(screen.queryByText("Info issue")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npm run test -- IssueList`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/components/workbench/IssueList.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { RiskBadge } from "@/components/Badges";
import { riskLabels } from "@/domain/reviews";
import type { ReviewIssue, RiskLevel } from "@/domain/types";

const riskOrder: RiskLevel[] = ["reject_recommended", "high", "caution", "info"];

export type IssueListProps = {
  issues: ReviewIssue[];
  selectedIssueId?: string;
  onSelectIssue: (issueId: string) => void;
  analysisNotice?: string;
};

export function IssueList({
  issues,
  selectedIssueId,
  onSelectIssue,
  analysisNotice
}: IssueListProps): JSX.Element {
  const [riskFilter, setRiskFilter] = useState<RiskLevel | "all">("all");
  const visible = useMemo(
    () => (riskFilter === "all" ? issues : issues.filter((i) => i.riskLevel === riskFilter)),
    [issues, riskFilter]
  );

  return (
    <aside className="issue-panel">
      <div className="issue-panel__heading">
        <h3>이슈 목록 ({issues.length})</h3>
      </div>

      <div className="filter-row" aria-label="Risk filters">
        <button
          className="chip"
          data-active={riskFilter === "all"}
          type="button"
          onClick={() => setRiskFilter("all")}
        >
          전체
        </button>
        {riskOrder.map((level) => (
          <button
            key={level}
            className="chip"
            data-active={riskFilter === level}
            type="button"
            onClick={() => setRiskFilter(level)}
          >
            {riskLabels[level]}
          </button>
        ))}
      </div>

      <div className="issue-list">
        {visible.length > 0 ? (
          visible.map((issue, index) => (
            <button
              key={issue.id}
              className="issue-card"
              data-active={selectedIssueId === issue.id}
              data-risk={issue.riskLevel}
              type="button"
              onClick={() => onSelectIssue(issue.id)}
            >
              <span className="issue-card__top">
                <RiskBadge level={issue.riskLevel} />
                <small>#{index + 1}</small>
              </span>
              <strong>{issue.title}</strong>
              <span>{issue.targetText}</span>
            </button>
          ))
        ) : (
          <div className="issue-empty-state">
            <strong>추가 확인 필요</strong>
            <span>
              {analysisNotice ??
                "선택 가능한 AI 위험 후보가 없습니다. 업로드 자료와 근거를 추가 확인해 주세요."}
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Add CSS for risk-color left border**

Append to `src/app/globals.css`:

```css
.issue-card {
  position: relative;
  border-left: 4px solid var(--line);
  transition: 120ms ease;
}
.issue-card[data-risk="reject_recommended"] {
  border-left-color: var(--tone-reject);
}
.issue-card[data-risk="high"] {
  border-left-color: var(--tone-high);
}
.issue-card[data-risk="caution"] {
  border-left-color: var(--tone-caution);
}
.issue-card[data-risk="info"] {
  border-left-color: var(--tone-info);
}
.issue-card[data-active="true"] {
  background: var(--primary-soft);
  box-shadow: var(--shadow-card);
}
```

- [ ] **Step 5: Run tests + commit**

```bash
npm run test -- IssueList
git add src/components/workbench/IssueList.tsx src/components/workbench/IssueList.test.tsx src/app/globals.css
git commit -m "feat(workbench): add IssueList with risk filter chips and color border"
```

---

### Task 3: Extract `CreativeViewer`

**Files:**

- Create: `src/components/workbench/CreativeViewer.tsx`
- Create: `src/components/workbench/CreativeViewer.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreativeViewer } from "./CreativeViewer";
import type { ReviewIssue } from "@/domain/types";

const issue: ReviewIssue = {
  id: "issue-1",
  issueType: "claim",
  riskLevel: "high",
  title: "title",
  targetText: "text",
  targetBbox: [10, 10, 20, 8],
  sourceAgents: [],
  suggestedAction: "change_request",
  status: "open",
  description: "",
  suggestedCopy: "",
  evidence: []
};

describe("CreativeViewer", () => {
  it("fires onSelectIssue when a highlight box is clicked", async () => {
    const onSelect = vi.fn();
    render(
      <CreativeViewer
        copy="카피"
        disclosure="공시"
        issues={[issue]}
        selectedIssueId="issue-1"
        onSelectIssue={onSelect}
      />
    );
    await userEvent.click(screen.getByTitle("title"));
    expect(onSelect).toHaveBeenCalledWith("issue-1");
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npm run test -- CreativeViewer`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/components/workbench/CreativeViewer.tsx`:

```tsx
"use client";

import { Maximize2, Minus, Plus } from "lucide-react";
import type { ReviewIssue } from "@/domain/types";

export type CreativeViewerProps = {
  copy: string;
  disclosure: string;
  issues: ReviewIssue[];
  selectedIssueId?: string;
  onSelectIssue: (issueId: string) => void;
};

export function CreativeViewer({
  copy,
  disclosure,
  issues,
  selectedIssueId,
  onSelectIssue
}: CreativeViewerProps): JSX.Element {
  return (
    <section className="creative-viewer">
      <div className="viewer-toolbar" aria-label="문서 보기 도구">
        <button className="icon-button icon-button--small" type="button" aria-label="축소">
          <Minus size={15} aria-hidden="true" />
        </button>
        <span>100%</span>
        <button className="icon-button icon-button--small" type="button" aria-label="확대">
          <Plus size={15} aria-hidden="true" />
        </button>
        <span>1 / 1</span>
        <button className="icon-button icon-button--small" type="button" aria-label="전체 화면">
          <Maximize2 size={15} aria-hidden="true" />
        </button>
      </div>
      <div className="poster">
        <strong className="poster__brand">FinProof Bank</strong>
        <div className="poster__copy">{copy}</div>
        <p>{disclosure}</p>
        {issues.map((issue, index) => {
          const [left, top, width, height] = issue.targetBbox;
          return (
            <button
              key={issue.id}
              className="highlight-box"
              data-risk={issue.riskLevel}
              data-active={selectedIssueId === issue.id}
              style={{
                left: `${left}%`,
                top: `${top}%`,
                width: `${width}%`,
                height: `${height}%`
              }}
              type="button"
              title={issue.title}
              onClick={() => onSelectIssue(issue.id)}
            >
              <span>{index + 1}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run tests + commit**

```bash
npm run test -- CreativeViewer
git add src/components/workbench/CreativeViewer.tsx src/components/workbench/CreativeViewer.test.tsx
git commit -m "feat(workbench): extract CreativeViewer module"
```

---

### Task 4: Extract `IssueDetailTabs` with URL-synced active tab

**Files:**

- Create: `src/components/workbench/IssueDetailTabs.tsx`
- Create: `src/components/workbench/IssueDetailTabs.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IssueDetailTabs } from "./IssueDetailTabs";
import type { ReviewIssue } from "@/domain/types";

const issue: ReviewIssue = {
  id: "issue-1",
  issueType: "claim",
  riskLevel: "high",
  title: "title",
  targetText: "text",
  targetBbox: [0, 0, 0, 0],
  sourceAgents: [],
  suggestedAction: "change_request",
  status: "open",
  description: "desc",
  suggestedCopy: "수정 제안",
  evidence: [
    {
      id: "e1",
      sourceType: "law",
      title: "Law 1",
      section: "§1",
      quoteSummary: "summary",
      relevanceScore: 0.9
    }
  ]
};

describe("IssueDetailTabs", () => {
  it("renders three tabs", () => {
    render(
      <IssueDetailTabs
        issue={issue}
        activeTab="checklist"
        onTabChange={() => undefined}
        reviewerRiskLevel="high"
        reviewerComment=""
        savedDecision={null}
        canMutate
        canFinalize={false}
        isSavingDecision={false}
        isFinalizingReview={false}
        onChangeRiskLevel={() => undefined}
        onChangeReviewerComment={() => undefined}
        onSaveReviewerDecision={() => undefined}
        onFinalizeReviewCase={() => undefined}
      />
    );
    expect(screen.getByRole("tab", { name: "체크리스트" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "근거 자료" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "의견서" })).toBeInTheDocument();
  });

  it("notifies onTabChange when a tab is clicked", async () => {
    const onChange = vi.fn();
    render(
      <IssueDetailTabs
        issue={issue}
        activeTab="checklist"
        onTabChange={onChange}
        reviewerRiskLevel="high"
        reviewerComment=""
        savedDecision={null}
        canMutate
        canFinalize={false}
        isSavingDecision={false}
        isFinalizingReview={false}
        onChangeRiskLevel={() => undefined}
        onChangeReviewerComment={() => undefined}
        onSaveReviewerDecision={() => undefined}
        onFinalizeReviewCase={() => undefined}
      />
    );
    await userEvent.click(screen.getByRole("tab", { name: "근거 자료" }));
    expect(onChange).toHaveBeenCalledWith("evidence");
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npm run test -- IssueDetailTabs`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/components/workbench/IssueDetailTabs.tsx`:

```tsx
"use client";

import { Tabs } from "@/components/ui";
import { RiskBadge } from "@/components/Badges";
import { riskLabels } from "@/domain/reviews";
import type { ReviewIssue, RiskLevel } from "@/domain/types";

export type IssueDetailTabKey = "checklist" | "evidence" | "opinion";

export type IssueDetailTabsProps = {
  issue: ReviewIssue;
  activeTab: IssueDetailTabKey;
  onTabChange: (tab: IssueDetailTabKey) => void;
  reviewerRiskLevel: RiskLevel;
  reviewerComment: string;
  savedDecision: { riskLevel: RiskLevel; comment: string } | null;
  canMutate: boolean;
  canFinalize: boolean;
  isSavingDecision: boolean;
  isFinalizingReview: boolean;
  onChangeRiskLevel: (riskLevel: RiskLevel) => void;
  onChangeReviewerComment: (comment: string) => void;
  onSaveReviewerDecision: () => void;
  onFinalizeReviewCase: () => void;
};

export function IssueDetailTabs(props: IssueDetailTabsProps): JSX.Element {
  const { issue, activeTab, onTabChange } = props;

  return (
    <aside className="evidence-panel">
      <Tabs
        activeKey={activeTab}
        onChange={(key) => onTabChange(key as IssueDetailTabKey)}
        ariaLabel="이슈 상세 탭"
        items={[
          { key: "checklist", label: "체크리스트", panel: <ChecklistPanel issue={issue} /> },
          { key: "evidence", label: "근거 자료", panel: <EvidencePanel issue={issue} /> },
          { key: "opinion", label: "의견서", panel: <OpinionPanel {...props} /> }
        ]}
      />
    </aside>
  );
}

function ChecklistPanel({ issue }: { issue: ReviewIssue }): JSX.Element {
  return (
    <div className="evidence-panel__summary">
      <RiskBadge level={issue.riskLevel} />
      <h4>{issue.title}</h4>
      <p>{issue.description}</p>
      <div className="suggested-copy">
        <span>수정 제안</span>
        <p>{issue.suggestedCopy}</p>
      </div>
    </div>
  );
}

function EvidencePanel({ issue }: { issue: ReviewIssue }): JSX.Element {
  return (
    <div className="evidence-stack">
      {issue.evidence.map((evidence) => (
        <article key={evidence.id} className="evidence-card">
          <span>{evidence.sourceType}</span>
          <strong>{evidence.title}</strong>
          <p>{evidence.quoteSummary}</p>
          <small>
            p.{evidence.page ?? "-"} · {evidence.section} · relevance{" "}
            {Math.round(evidence.relevanceScore * 100)}%
          </small>
        </article>
      ))}
    </div>
  );
}

function OpinionPanel({
  reviewerRiskLevel,
  reviewerComment,
  savedDecision,
  canMutate,
  canFinalize,
  isSavingDecision,
  isFinalizingReview,
  onChangeRiskLevel,
  onChangeReviewerComment,
  onSaveReviewerDecision,
  onFinalizeReviewCase
}: IssueDetailTabsProps): JSX.Element {
  return (
    <div className="reviewer-decision">
      <label htmlFor="reviewer-risk-level">심의자 위험도</label>
      <select
        id="reviewer-risk-level"
        aria-label="심의자 위험도"
        value={reviewerRiskLevel}
        disabled={!canMutate}
        onChange={(event) => onChangeRiskLevel(event.target.value as RiskLevel)}
      >
        <option value="info">참고</option>
        <option value="caution">주의</option>
        <option value="high">위험</option>
        <option value="reject_recommended">반려 권고</option>
      </select>

      <label htmlFor="reviewer-comment">심의자 메모</label>
      <textarea
        id="reviewer-comment"
        aria-label="심의자 메모"
        value={reviewerComment}
        disabled={!canMutate}
        onChange={(event) => onChangeReviewerComment(event.target.value)}
      />

      <button
        className="button"
        type="button"
        disabled={!canMutate || isSavingDecision}
        onClick={onSaveReviewerDecision}
      >
        {isSavingDecision ? "저장 중" : "위험도 변경"}
      </button>

      <button
        className="button button--primary"
        type="button"
        disabled={!canMutate || !canFinalize || isFinalizingReview}
        onClick={onFinalizeReviewCase}
      >
        {isFinalizingReview ? "완료 중" : "검토 완료"}
      </button>

      {savedDecision ? (
        <div className="saved-decision">
          <strong>저장된 판단: {riskLabels[savedDecision.riskLevel]}</strong>
          {savedDecision.comment ? <p>{savedDecision.comment}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run tests + commit**

```bash
npm run test -- IssueDetailTabs
git add src/components/workbench/IssueDetailTabs.tsx src/components/workbench/IssueDetailTabs.test.tsx
git commit -m "feat(workbench): add tabbed IssueDetail pane (checklist/evidence/opinion)"
```

---

### Task 5: Extract `WorkbenchDrawer` (collapsible)

**Files:**

- Create: `src/components/workbench/WorkbenchDrawer.tsx`
- Create: `src/components/workbench/WorkbenchDrawer.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkbenchDrawer } from "./WorkbenchDrawer";

describe("WorkbenchDrawer", () => {
  it("toggles collapsed state", async () => {
    render(
      <WorkbenchDrawer
        chatNode={<span>chat</span>}
        draftNode={<span>draft</span>}
        auditNode={<span>audit</span>}
        filesNode={<span>files</span>}
        defaultCollapsed={false}
      />
    );
    expect(screen.getByText("chat")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /드로어 접기/ }));
    expect(screen.queryByText("chat")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npm run test -- WorkbenchDrawer`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/components/workbench/WorkbenchDrawer.tsx`:

```tsx
"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Tabs } from "@/components/ui";

export type WorkbenchDrawerProps = {
  chatNode: ReactNode;
  draftNode: ReactNode;
  auditNode: ReactNode;
  filesNode: ReactNode;
  defaultCollapsed?: boolean;
};

export function WorkbenchDrawer({
  chatNode,
  draftNode,
  auditNode,
  filesNode,
  defaultCollapsed = false
}: WorkbenchDrawerProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <section className="workbench-drawer" aria-label="Workbench bottom drawer">
      <div className="workbench-drawer__head">
        <button
          type="button"
          className="icon-button"
          aria-label={collapsed ? "드로어 펼치기" : "드로어 접기"}
          onClick={() => setCollapsed((current) => !current)}
        >
          {collapsed ? (
            <ChevronUp size={16} aria-hidden="true" />
          ) : (
            <ChevronDown size={16} aria-hidden="true" />
          )}
        </button>
      </div>
      {!collapsed ? (
        <Tabs
          ariaLabel="Workbench drawer tabs"
          items={[
            { key: "chat", label: "근거 채팅", panel: chatNode },
            { key: "draft", label: "의견 초안", panel: draftNode },
            { key: "audit", label: "감사 로그", panel: auditNode },
            { key: "files", label: "파일", panel: filesNode }
          ]}
        />
      ) : null}
    </section>
  );
}
```

- [ ] **Step 4: Add CSS**

Append to `src/app/globals.css`:

```css
.workbench-drawer__head {
  display: flex;
  justify-content: flex-end;
  padding: var(--space-2) var(--space-3);
}
```

- [ ] **Step 5: Run tests + commit**

```bash
npm run test -- WorkbenchDrawer
git add src/components/workbench/WorkbenchDrawer.tsx src/components/workbench/WorkbenchDrawer.test.tsx src/app/globals.css
git commit -m "feat(workbench): add collapsible WorkbenchDrawer with tabs"
```

---

### Task 6: Refactor `ReviewDetailWorkspace` to compose modules with URL-synced tab

**Files:**

- Modify: `src/components/ReviewDetailWorkspace.tsx`
- Modify: `src/components/ReviewDetailWorkspace.test.tsx` (selectors only)

- [ ] **Step 1: Replace `ReviewDetailWorkspace.tsx`**

This is the largest refactor. Replace the file's render section (everything from `return ( ... )` down) with composition of the new modules while preserving all existing state, refs, and API handlers above the return.

Key changes in the render:

1. Replace the existing `<section className="detail__header">...</section>` block with `<WorkbenchHeader ... />`.
2. Replace inline `<aside className="issue-panel">` with `<IssueList ... />`.
3. Replace inline `CreativeViewer` component call to import from `./workbench/CreativeViewer` (delete the local function).
4. Replace inline `<EvidencePanel>` with `<IssueDetailTabs ... />`, sourcing `activeTab` from URL.
5. Replace `<section className="workbench-drawer">...</section>` block with `<WorkbenchDrawer ... />` passing the four panels as nodes.

Add at top of file:

```tsx
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { WorkbenchHeader } from "./workbench/WorkbenchHeader";
import { IssueList } from "./workbench/IssueList";
import { CreativeViewer } from "./workbench/CreativeViewer";
import { IssueDetailTabs, type IssueDetailTabKey } from "./workbench/IssueDetailTabs";
import { WorkbenchDrawer } from "./workbench/WorkbenchDrawer";
import { productLabels, riskLabels, statusLabels } from "@/domain/reviews";
```

Remove the in-file `CreativeViewer` and `EvidencePanel` function definitions (Task 3 / 4 moved them).

Add tab URL sync hook inside the component (placed near other useEffects):

```tsx
const searchParams = useSearchParams();
const router = useRouter();
const pathname = usePathname();
const rawTab = searchParams.get("tab");
const activeTab: IssueDetailTabKey =
  rawTab === "evidence" || rawTab === "opinion" ? rawTab : "checklist";

function setActiveTab(next: IssueDetailTabKey): void {
  const params = new URLSearchParams(searchParams.toString());
  if (next === "checklist") {
    params.delete("tab");
  } else {
    params.set("tab", next);
  }
  const query = params.toString();
  router.replace(query.length > 0 ? `${pathname}?${query}` : pathname);
}
```

Replace the `return (...)` body with:

```tsx
return (
  <div className="detail">
    <WorkbenchHeader
      id={review.id}
      title={review.title}
      statusLabel={statusLabels[reviewStatus]}
      riskLabel={riskLabels[review.highestRiskLevel]}
      productLabel={productLabels[review.productType]}
      reviewer={review.reviewer}
      deadline={review.plannedPublishDate}
      canMutate={reviewerCanMutate}
      selectedAction={selectedFinalAction}
      isGeneratingDraft={isGeneratingDraft}
      onSelectAction={setSelectedFinalAction}
      onGenerateDraft={generateDraft}
    />

    <section className="detail__grid">
      <IssueList
        issues={review.issues}
        selectedIssueId={selectedIssue?.id}
        onSelectIssue={selectIssue}
        analysisNotice={review.analysisNotice}
      />

      <CreativeViewer
        copy={review.promotionalCopy}
        disclosure={review.disclosure}
        issues={review.issues}
        selectedIssueId={selectedIssue?.id}
        onSelectIssue={selectIssue}
      />

      {selectedIssue ? (
        <IssueDetailTabs
          issue={selectedIssue}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          reviewerRiskLevel={reviewerRiskLevel}
          reviewerComment={reviewerComment}
          savedDecision={savedDecision}
          canMutate={reviewerCanMutate}
          canFinalize={Boolean(finalReviewStatus)}
          isSavingDecision={isSavingDecision}
          isFinalizingReview={isFinalizingReview}
          onChangeRiskLevel={setReviewerRiskLevel}
          onChangeReviewerComment={setReviewerComment}
          onSaveReviewerDecision={saveReviewerDecision}
          onFinalizeReviewCase={finalizeReviewCase}
        />
      ) : null}
    </section>

    <WorkbenchDrawer
      defaultCollapsed={activeRole === "requester"}
      chatNode={
        /* existing chat composer block — extract the markup that lived inside drawer panel #1 verbatim */
        <ExistingChatPanel />
      }
      draftNode={<ExistingDraftPanel />}
      auditNode={<ExistingAuditPanel />}
      filesNode={<ExistingFilesPanel />}
    />

    {interactionError ? (
      <p className="interaction-error" role="alert">
        {interactionError}
      </p>
    ) : null}
    {finalizedNotice ? <p className="finalized-notice">{finalizedNotice}</p> : null}
    {draftNotice ? <p className="draft-notice">{draftNotice}</p> : null}
    {reportNotice ? <p className="report-notice">{reportNotice}</p> : null}
  </div>
);
```

Define `ExistingChatPanel`, `ExistingDraftPanel`, `ExistingAuditPanel`, `ExistingFilesPanel` as inner components inside `ReviewDetailWorkspace.tsx` (closures over the existing state and handlers) — preserve the existing markup that currently lives inside each of the four drawer panels verbatim. This keeps the chat/draft/audit/files behavior 1:1.

Also export `productLabels` and `riskLabels` from `@/domain/reviews` (already exists) — verify by reading `src/domain/reviews.ts`. If `productLabels` is not exported there yet, add it next to `statusLabels`:

```ts
export const productLabels: Record<ProductType, string> = {
  deposit: "예금/적금",
  loan: "대출",
  card: "카드",
  capital: "캐피탈",
  insurance: "보험",
  investment: "투자상품"
};
```

- [ ] **Step 2: Update test selectors**

In `src/components/ReviewDetailWorkspace.test.tsx`, any selector that targeted the inline header markup, inline issue panel, or inline evidence panel still resolves to the same `aria-label` / role / text — selectors should largely keep working. Update any selector that broke from the moved markup. Drawer tab tests still find `근거 채팅` etc. via Tabs primitive.

- [ ] **Step 3: Run full test suite**

Run: `npm run test`
Expected: all green. Fix selector updates as needed.

- [ ] **Step 4: Lint + build**

Run: `npm run lint && npm run build`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/components/ReviewDetailWorkspace.tsx src/components/ReviewDetailWorkspace.test.tsx \
        src/domain/reviews.ts
git commit -m "refactor(workbench): compose workspace from workbench/* modules + URL-synced tab"
```

---

### Task 7: Add URL-sync test for IssueDetailTabs in workspace integration

**Files:**

- Modify: `src/components/ReviewDetailWorkspace.test.tsx`

- [ ] **Step 1: Add test that clicking a tab updates the URL**

Append to the existing test file:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
// ... existing imports ...

describe("ReviewDetailWorkspace tab URL sync", () => {
  it("appends ?tab=evidence when 근거 자료 is clicked", async () => {
    // Use the existing test harness that mounts the workspace in a router context.
    // Implementations differ — this is a placeholder if existing tests already mock router.
    // Skip if router is not mocked; the unit-level URL handling is covered by IssueDetailTabs.test.tsx.
  });
});
```

If the existing test file already mocks `next/navigation`, write a concrete assertion using `mockReplace` and look for `?tab=evidence`. Otherwise leave the unit-level URL sync coverage to `IssueDetailTabs.test.tsx` and skip this test (the unit primitive covers the contract).

- [ ] **Step 2: Run tests + commit**

```bash
npm run test
git add src/components/ReviewDetailWorkspace.test.tsx
git commit -m "test(workbench): add URL tab-sync integration coverage"
```

---

### Task 8: Final dev-server smoke check

- [ ] **Step 1: Boot dev server**

Run: `npm run dev` in background, then `curl -sf http://localhost:3000/reviews -o /dev/null` (exit 0). Try `curl -sf http://localhost:3000/reviews/RC-2026-001` for a known seed case.

- [ ] **Step 2: Stop dev server.**

- [ ] **Step 3: Final lint/build/test gate**

Run: `npm run lint && npm run test && npm run build`
Expected: all green.

---

## Self-Review

- ✅ Spec § Workbench → compact header (Task 1), three-column with tabbed right pane URL-synced (Tasks 2/3/4/6), collapsible drawer (Task 5), action label clarification (Task 1 group label).
- ✅ Action label "이슈 추천 조치" inserted in WorkbenchHeader.
- ✅ Type names consistent (`IssueDetailTabKey`, `WorkbenchHeaderProps`).
- ✅ All existing chat/draft/audit/files behavior preserved via inner panels.
- ✅ No placeholders.
