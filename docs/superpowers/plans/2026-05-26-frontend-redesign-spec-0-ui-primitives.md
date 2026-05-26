# Spec 0 — Design Tokens & Shared UI Primitives Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add design tokens to globals.css and build the shared UI primitives (KpiCard, Tabs, Stepper, DropZone, FilterBar) plus a top-level ErrorBoundary, so subsequent screen specs have a stable foundation.

**Architecture:** Pure additive primitives in `src/components/ui/`. No existing component changes other than `AppShell` adding an `ErrorBoundary` wrapper. globals.css additions are additive — existing class behavior preserved.

**Tech Stack:** Next.js 16, React 19, TypeScript, vitest + Testing Library, lucide-react icons.

**Source spec:** `docs/superpowers/specs/2026-05-26-frontend-stitch-redesign-design.md` § Spec 0.

---

### Task 1: Add design tokens to `globals.css`

**Files:**
- Modify: `src/app/globals.css` (insert after existing `:root` block, around line 27)

- [ ] **Step 1: Append new token block to `:root`**

Edit `src/app/globals.css`. Replace the closing `}` of `:root` (line 27) so the block ends with these added tokens before `color-scheme: light;`:

```css
  /* Gray scale */
  --gray-50: #fafafa;
  --gray-100: #f1f3f6;
  --gray-200: #e1e5ec;
  --gray-300: #c9ced8;
  --gray-400: #aeb6c4;
  --gray-500: #677083;
  --gray-700: #343b49;
  --gray-900: #14181f;

  /* Semantic tone aliases (additive) */
  --tone-info: var(--risk-info);
  --tone-info-bg: var(--risk-info-bg);
  --tone-caution: var(--risk-caution);
  --tone-caution-bg: var(--risk-caution-bg);
  --tone-high: var(--risk-high);
  --tone-high-bg: var(--risk-high-bg);
  --tone-reject: var(--risk-reject);
  --tone-reject-bg: var(--risk-reject-bg);
  --tone-verified: var(--verified);
  --tone-verified-bg: var(--verified-bg);
  --tone-in-progress: #0a6cdb;
  --tone-in-progress-bg: #e6f0ff;

  /* Spacing scale (4px grid) */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-7: 32px;
  --space-8: 48px;

  /* Radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;

  /* Shadows */
  --shadow-card: 0 1px 2px rgba(21, 25, 35, 0.06), 0 1px 3px rgba(21, 25, 35, 0.04);
  --shadow-elevated: 0 8px 18px rgba(21, 25, 35, 0.10);

  /* Typography */
  --font-size-xs: 11px;
  --font-size-sm: 13px;
  --font-size-base: 14px;
  --font-size-lg: 16px;
  --font-size-xl: 20px;
  --font-size-2xl: 28px;
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;
  --line-height-tight: 1.25;
  --line-height-normal: 1.5;
  --line-height-relaxed: 1.65;
```

- [ ] **Step 2: Verify build still passes**

Run: `npm run lint && npm run build`
Expected: green. No visual regression because tokens are additive.

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(ui): add design tokens for shared primitives"
```

---

### Task 2: `ErrorBoundary` component + AppShell integration

**Files:**
- Create: `src/components/ErrorBoundary.tsx`
- Create: `src/components/ErrorBoundary.test.tsx`
- Modify: `src/components/AppShell.tsx`

- [ ] **Step 1: Write failing test**

Create `src/components/ErrorBoundary.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

function Boom(): JSX.Element {
  throw new Error("boom");
}

describe("ErrorBoundary", () => {
  it("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <span>safe</span>
      </ErrorBoundary>
    );
    expect(screen.getByText("safe")).toBeInTheDocument();
  });

  it("renders fallback when a child throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByRole("alert")).toHaveTextContent("화면을 불러오지 못했습니다");
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npm run test -- ErrorBoundary`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `ErrorBoundary`**

Create `src/components/ErrorBoundary.tsx`:

```tsx
"use client";

import { Component, type ReactNode } from "react";

type ErrorBoundaryProps = { children: ReactNode };
type ErrorBoundaryState = { hasError: boolean };

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    if (process.env.NODE_ENV !== "production") {
      console.error("[ErrorBoundary]", error);
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="error-boundary" role="alert">
          <strong>화면을 불러오지 못했습니다.</strong>
          <p>잠시 후 다시 시도해 주세요.</p>
        </div>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 4: Wrap AppShell children**

In `src/components/AppShell.tsx`, import `ErrorBoundary` and wrap the workspace content (line 120 — `<div className="workspace__content">{children}</div>`):

```tsx
import { ErrorBoundary } from "./ErrorBoundary";

// inside the return, replace the line with:
<div className="workspace__content">
  <ErrorBoundary>{children}</ErrorBoundary>
</div>
```

- [ ] **Step 5: Add minimal CSS for fallback**

Append to `src/app/globals.css`:

```css
.error-boundary {
  margin: var(--space-7) auto;
  max-width: 520px;
  padding: var(--space-6);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--surface);
  box-shadow: var(--shadow-card);
}
.error-boundary strong { display: block; font-size: var(--font-size-lg); margin-bottom: var(--space-2); }
```

- [ ] **Step 6: Run tests + build**

Run: `npm run test && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/components/ErrorBoundary.tsx src/components/ErrorBoundary.test.tsx \
        src/components/AppShell.tsx src/app/globals.css
git commit -m "feat(ui): add ErrorBoundary and wrap workspace content"
```

---

### Task 3: `KpiCard` primitive

**Files:**
- Create: `src/components/ui/KpiCard.tsx`
- Create: `src/components/ui/KpiCard.test.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Write failing test**

Create `src/components/ui/KpiCard.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KpiCard } from "./KpiCard";

describe("KpiCard", () => {
  it("renders label, value, and tone class", () => {
    render(<KpiCard label="분석 대기" value={7} tone="primary" />);
    expect(screen.getByText("분석 대기")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByRole("group")).toHaveAttribute("data-tone", "primary");
  });

  it("renders as a button when onClick provided and fires it", async () => {
    const handler = vi.fn();
    render(<KpiCard label="반려 권고" value={2} tone="danger" onClick={handler} />);
    await userEvent.click(screen.getByRole("button", { name: /반려 권고/ }));
    expect(handler).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npm run test -- KpiCard`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/components/ui/KpiCard.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";

export type KpiTone = "primary" | "neutral" | "warning" | "danger" | "success";

export type KpiCardProps = {
  label: string;
  value: number | string;
  tone?: KpiTone;
  hint?: ReactNode;
  onClick?: () => void;
  ariaLabel?: string;
};

export function KpiCard({
  label,
  value,
  tone = "neutral",
  hint,
  onClick,
  ariaLabel
}: KpiCardProps): JSX.Element {
  const content = (
    <>
      <span className="kpi-card__label">{label}</span>
      <strong className="kpi-card__value">{value}</strong>
      {hint ? <span className="kpi-card__hint">{hint}</span> : null}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className="kpi-card kpi-card--button"
        role="button"
        aria-label={ariaLabel ?? `${label} 필터 적용`}
        data-tone={tone}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return (
    <div className="kpi-card" role="group" aria-label={ariaLabel ?? label} data-tone={tone}>
      {content}
    </div>
  );
}
```

- [ ] **Step 4: Add CSS**

Append to `src/app/globals.css`:

```css
.kpi-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-5) var(--space-6);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  min-height: 96px;
  text-align: left;
  font-family: inherit;
}
.kpi-card--button { cursor: pointer; }
.kpi-card--button:hover { border-color: var(--line-strong); transform: translateY(-1px); transition: 120ms ease; }
.kpi-card__label { font-size: var(--font-size-sm); color: var(--muted); font-weight: var(--font-weight-medium); }
.kpi-card__value { font-size: var(--font-size-2xl); color: var(--text); line-height: var(--line-height-tight); font-weight: var(--font-weight-bold); }
.kpi-card__hint { font-size: var(--font-size-xs); color: var(--muted); }
.kpi-card[data-tone="primary"] { border-left: 4px solid var(--primary); }
.kpi-card[data-tone="warning"] { border-left: 4px solid var(--tone-caution); }
.kpi-card[data-tone="danger"] { border-left: 4px solid var(--tone-high); }
.kpi-card[data-tone="success"] { border-left: 4px solid var(--tone-verified); }
.kpi-card[data-tone="neutral"] { border-left: 4px solid var(--gray-300); }
.kpi-card[data-tone="danger"] .kpi-card__value { color: var(--tone-high); }
```

- [ ] **Step 5: Run tests**

Run: `npm run test -- KpiCard`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/KpiCard.tsx src/components/ui/KpiCard.test.tsx src/app/globals.css
git commit -m "feat(ui): add KpiCard primitive with tone variants"
```

---

### Task 4: `Tabs` primitive

**Files:**
- Create: `src/components/ui/Tabs.tsx`
- Create: `src/components/ui/Tabs.test.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Write failing test**

Create `src/components/ui/Tabs.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tabs } from "./Tabs";

const items = [
  { key: "a", label: "A", panel: <span>A-content</span> },
  { key: "b", label: "B", panel: <span>B-content</span> }
];

describe("Tabs", () => {
  it("renders first tab active by default and shows its panel", () => {
    render(<Tabs items={items} />);
    expect(screen.getByRole("tab", { name: "A" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("A-content")).toBeInTheDocument();
  });

  it("switches active tab on click", async () => {
    render(<Tabs items={items} />);
    await userEvent.click(screen.getByRole("tab", { name: "B" }));
    expect(screen.getByRole("tab", { name: "B" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("B-content")).toBeInTheDocument();
  });

  it("supports controlled mode via activeKey/onChange", async () => {
    const onChange = vi.fn();
    render(<Tabs items={items} activeKey="b" onChange={onChange} />);
    expect(screen.getByText("B-content")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "A" }));
    expect(onChange).toHaveBeenCalledWith("a");
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npm run test -- Tabs`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/components/ui/Tabs.tsx`:

```tsx
"use client";

import { useState, type ReactNode } from "react";

export type TabItem = { key: string; label: ReactNode; panel: ReactNode; disabled?: boolean };

export type TabsProps = {
  items: TabItem[];
  activeKey?: string;
  defaultActiveKey?: string;
  onChange?: (key: string) => void;
  ariaLabel?: string;
};

export function Tabs({
  items,
  activeKey,
  defaultActiveKey,
  onChange,
  ariaLabel = "탭"
}: TabsProps): JSX.Element {
  const [internalKey, setInternalKey] = useState(defaultActiveKey ?? items[0]?.key);
  const currentKey = activeKey ?? internalKey;
  const activePanel = items.find((item) => item.key === currentKey)?.panel ?? null;

  function selectTab(key: string): void {
    if (activeKey === undefined) {
      setInternalKey(key);
    }
    onChange?.(key);
  }

  return (
    <div className="tabs">
      <div className="tabs__list" role="tablist" aria-label={ariaLabel}>
        {items.map((item) => {
          const isActive = item.key === currentKey;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${item.key}`}
              id={`tab-${item.key}`}
              className="tabs__tab"
              data-active={isActive}
              disabled={item.disabled}
              onClick={() => selectTab(item.key)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      <div
        className="tabs__panel"
        role="tabpanel"
        id={`tabpanel-${currentKey}`}
        aria-labelledby={`tab-${currentKey}`}
      >
        {activePanel}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add CSS**

Append to `src/app/globals.css`:

```css
.tabs__list { display: flex; gap: var(--space-1); border-bottom: 1px solid var(--line); }
.tabs__tab {
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  padding: var(--space-3) var(--space-4);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--muted);
  cursor: pointer;
}
.tabs__tab[data-active="true"] { color: var(--primary); border-bottom-color: var(--primary); }
.tabs__tab:hover:not([disabled]) { color: var(--text); }
.tabs__panel { padding-top: var(--space-4); }
```

- [ ] **Step 5: Run tests**

Run: `npm run test -- Tabs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/Tabs.tsx src/components/ui/Tabs.test.tsx src/app/globals.css
git commit -m "feat(ui): add Tabs primitive with controlled/uncontrolled modes"
```

---

### Task 5: `Stepper` primitive

**Files:**
- Create: `src/components/ui/Stepper.tsx`
- Create: `src/components/ui/Stepper.test.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Write failing test**

Create `src/components/ui/Stepper.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Stepper } from "./Stepper";

describe("Stepper", () => {
  it("renders all steps with status data attributes", () => {
    render(
      <Stepper
        steps={[
          { key: "meta", label: "메타", status: "done" },
          { key: "upload", label: "업로드", status: "active" },
          { key: "check", label: "확인", status: "pending" }
        ]}
      />
    );
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("data-status", "done");
    expect(items[1]).toHaveAttribute("data-status", "active");
    expect(items[2]).toHaveAttribute("data-status", "pending");
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npm run test -- Stepper`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/components/ui/Stepper.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";

export type StepStatus = "pending" | "active" | "done";

export type StepperItem = { key: string; label: ReactNode; status: StepStatus };

export type StepperProps = {
  steps: StepperItem[];
  ariaLabel?: string;
};

export function Stepper({ steps, ariaLabel = "진행 단계" }: StepperProps): JSX.Element {
  return (
    <ol className="stepper" aria-label={ariaLabel}>
      {steps.map((step, index) => (
        <li key={step.key} data-status={step.status}>
          <span className="stepper__index" aria-hidden="true">
            {index + 1}
          </span>
          <span className="stepper__label">{step.label}</span>
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 4: Add CSS**

Append to `src/app/globals.css`:

```css
.stepper { display: flex; gap: var(--space-2); list-style: none; padding: 0; margin: 0; flex-wrap: wrap; }
.stepper li {
  display: inline-flex; align-items: center; gap: var(--space-2);
  padding: var(--space-2) var(--space-3); border-radius: var(--radius-md);
  background: var(--surface-muted); color: var(--muted); font-size: var(--font-size-sm);
}
.stepper__index {
  width: 22px; height: 22px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--gray-300); color: var(--surface); font-weight: var(--font-weight-semibold);
  font-size: var(--font-size-xs);
}
.stepper li[data-status="active"] { background: var(--primary-soft); color: var(--primary-strong); }
.stepper li[data-status="active"] .stepper__index { background: var(--primary); color: var(--surface); }
.stepper li[data-status="done"] { background: var(--tone-verified-bg); color: var(--tone-verified); }
.stepper li[data-status="done"] .stepper__index { background: var(--tone-verified); color: var(--surface); }
```

- [ ] **Step 5: Run tests**

Run: `npm run test -- Stepper`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/Stepper.tsx src/components/ui/Stepper.test.tsx src/app/globals.css
git commit -m "feat(ui): add Stepper primitive with state-driven styles"
```

---

### Task 6: `DropZone` primitive

**Files:**
- Create: `src/components/ui/DropZone.tsx`
- Create: `src/components/ui/DropZone.test.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Write failing test**

Create `src/components/ui/DropZone.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DropZone } from "./DropZone";

describe("DropZone", () => {
  it("renders helper text and shows file list with remove buttons", async () => {
    const onRemove = vi.fn();
    render(
      <DropZone
        accept=".pdf"
        files={[new File(["x"], "a.pdf", { type: "application/pdf" })]}
        helperText="파일을 끌어다 놓거나 클릭"
        onFilesSelected={() => undefined}
        onRemoveFile={onRemove}
      />
    );
    expect(screen.getByText("파일을 끌어다 놓거나 클릭")).toBeInTheDocument();
    expect(screen.getByText("a.pdf")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /a.pdf 제거/ }));
    expect(onRemove).toHaveBeenCalledWith(0);
  });

  it("fires onFilesSelected when file input changes", async () => {
    const onSelect = vi.fn();
    render(
      <DropZone
        accept=".pdf"
        files={[]}
        helperText="upload"
        onFilesSelected={onSelect}
        onRemoveFile={() => undefined}
      />
    );
    const input = screen.getByLabelText("upload", { selector: "input" }) as HTMLInputElement;
    await userEvent.upload(input, new File(["y"], "b.pdf", { type: "application/pdf" }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect.mock.calls[0][0][0].name).toBe("b.pdf");
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npm run test -- DropZone`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/components/ui/DropZone.tsx`:

```tsx
"use client";

import { useState, type DragEvent } from "react";
import { Upload, X } from "lucide-react";

export type DropZoneProps = {
  accept: string;
  multiple?: boolean;
  files: File[];
  helperText: string;
  error?: string | null;
  onFilesSelected: (files: File[]) => void;
  onRemoveFile: (index: number) => void;
};

export function DropZone({
  accept,
  multiple = true,
  files,
  helperText,
  error,
  onFilesSelected,
  onRemoveFile
}: DropZoneProps): JSX.Element {
  const [isDragging, setIsDragging] = useState(false);

  function handleDrop(event: DragEvent<HTMLLabelElement>): void {
    event.preventDefault();
    setIsDragging(false);
    const dropped = Array.from(event.dataTransfer.files);
    if (dropped.length > 0) {
      onFilesSelected(dropped);
    }
  }

  return (
    <div className="dropzone-wrap">
      <label
        className="dropzone"
        data-dragging={isDragging}
        data-has-error={Boolean(error)}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <Upload size={26} aria-hidden="true" />
        <strong>{helperText}</strong>
        <span>파일을 끌어다 놓거나 클릭하여 선택</span>
        <input
          aria-label={helperText}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={(event) => {
            const selected = Array.from(event.target.files ?? []);
            if (selected.length > 0) {
              onFilesSelected(selected);
            }
          }}
        />
      </label>

      {files.length > 0 ? (
        <ul className="dropzone__file-list" aria-label="선택된 파일">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`}>
              <span>{file.name}</span>
              <button
                type="button"
                aria-label={`${file.name} 제거`}
                onClick={() => onRemoveFile(index)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p className="dropzone__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Add CSS**

Append to `src/app/globals.css`:

```css
.dropzone-wrap { display: flex; flex-direction: column; gap: var(--space-3); }
.dropzone {
  display: flex; flex-direction: column; align-items: center; gap: var(--space-2);
  padding: var(--space-7) var(--space-6);
  border: 2px dashed var(--line);
  border-radius: var(--radius-lg);
  background: var(--surface-subtle);
  cursor: pointer;
  color: var(--muted);
}
.dropzone[data-dragging="true"] { border-color: var(--primary); background: var(--primary-soft); color: var(--primary-strong); }
.dropzone[data-has-error="true"] { border-color: var(--tone-high); }
.dropzone strong { color: var(--text); font-size: var(--font-size-base); }
.dropzone input[type="file"] { position: absolute; opacity: 0; pointer-events: none; width: 0; height: 0; }
.dropzone__file-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.dropzone__file-list li { display: flex; align-items: center; justify-content: space-between; padding: var(--space-2) var(--space-3); background: var(--surface-muted); border-radius: var(--radius-sm); font-size: var(--font-size-sm); }
.dropzone__file-list button { background: transparent; border: 0; cursor: pointer; color: var(--muted); display: inline-flex; padding: 4px; }
.dropzone__file-list button:hover { color: var(--tone-high); }
.dropzone__error { color: var(--tone-high); font-size: var(--font-size-sm); margin: 0; }
```

- [ ] **Step 5: Run tests**

Run: `npm run test -- DropZone`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/DropZone.tsx src/components/ui/DropZone.test.tsx src/app/globals.css
git commit -m "feat(ui): add DropZone primitive with drag/drop and file list"
```

---

### Task 7: `FilterBar` primitive

**Files:**
- Create: `src/components/ui/FilterBar.tsx`
- Create: `src/components/ui/FilterBar.test.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Write failing test**

Create `src/components/ui/FilterBar.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilterBar, type FilterGroup } from "./FilterBar";

describe("FilterBar", () => {
  it("renders search input and groups, fires callbacks", async () => {
    const onSearch = vi.fn();
    const onChange = vi.fn();
    const groups: FilterGroup[] = [
      {
        key: "status",
        label: "상태",
        value: "all",
        options: [
          { value: "all", label: "전체" },
          { value: "open", label: "열림" }
        ]
      }
    ];
    render(
      <FilterBar
        searchValue=""
        searchPlaceholder="검색"
        onSearchChange={onSearch}
        groups={groups}
        onGroupChange={onChange}
      />
    );
    await userEvent.type(screen.getByPlaceholderText("검색"), "abc");
    expect(onSearch).toHaveBeenCalled();
    await userEvent.selectOptions(screen.getByLabelText("상태"), "open");
    expect(onChange).toHaveBeenCalledWith("status", "open");
  });

  it("shows reset button when any group has a non-default value and search is non-empty", async () => {
    const onReset = vi.fn();
    render(
      <FilterBar
        searchValue="x"
        searchPlaceholder="검색"
        onSearchChange={() => undefined}
        groups={[
          {
            key: "status",
            label: "상태",
            value: "open",
            defaultValue: "all",
            options: [
              { value: "all", label: "전체" },
              { value: "open", label: "열림" }
            ]
          }
        ]}
        onGroupChange={() => undefined}
        onReset={onReset}
      />
    );
    const button = screen.getByRole("button", { name: "필터 초기화" });
    await userEvent.click(button);
    expect(onReset).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npm run test -- FilterBar`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/components/ui/FilterBar.tsx`:

```tsx
"use client";

import { Search, X } from "lucide-react";

export type FilterOption = { value: string; label: string };

export type FilterGroup = {
  key: string;
  label: string;
  value: string;
  defaultValue?: string;
  options: FilterOption[];
};

export type FilterBarProps = {
  searchValue: string;
  searchPlaceholder: string;
  onSearchChange: (value: string) => void;
  groups: FilterGroup[];
  onGroupChange: (key: string, value: string) => void;
  onReset?: () => void;
};

export function FilterBar({
  searchValue,
  searchPlaceholder,
  onSearchChange,
  groups,
  onGroupChange,
  onReset
}: FilterBarProps): JSX.Element {
  const hasActiveFilter =
    searchValue.length > 0 ||
    groups.some((group) => (group.defaultValue ?? group.options[0]?.value) !== group.value);

  return (
    <div className="filter-bar">
      <label className="filter-bar__search">
        <Search size={16} aria-hidden="true" />
        <span className="sr-only">검색</span>
        <input
          aria-label="검색"
          placeholder={searchPlaceholder}
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </label>
      <div className="filter-bar__groups">
        {groups.map((group) => (
          <label key={group.key} className="filter-bar__group">
            <span className="sr-only">{group.label}</span>
            <select
              aria-label={group.label}
              value={group.value}
              onChange={(event) => onGroupChange(group.key, event.target.value)}
            >
              {group.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ))}
        {hasActiveFilter && onReset ? (
          <button
            type="button"
            className="filter-bar__reset"
            aria-label="필터 초기화"
            onClick={onReset}
          >
            <X size={14} aria-hidden="true" />
            초기화
          </button>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add CSS**

Append to `src/app/globals.css`:

```css
.filter-bar { display: flex; flex-direction: column; gap: var(--space-3); }
.filter-bar__search {
  display: flex; align-items: center; gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
}
.filter-bar__search input { border: 0; outline: none; width: 100%; background: transparent; font-size: var(--font-size-sm); }
.filter-bar__groups { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.filter-bar__group select {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--surface);
  font-size: var(--font-size-sm);
  color: var(--text);
}
.filter-bar__reset {
  display: inline-flex; align-items: center; gap: 4px;
  padding: var(--space-2) var(--space-3);
  background: var(--surface);
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--muted);
  cursor: pointer;
}
.filter-bar__reset:hover { color: var(--text); border-color: var(--muted); }
```

- [ ] **Step 5: Run tests**

Run: `npm run test -- FilterBar`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/FilterBar.tsx src/components/ui/FilterBar.test.tsx src/app/globals.css
git commit -m "feat(ui): add FilterBar primitive with search and grouped selects"
```

---

### Task 8: Barrel export + final verification

**Files:**
- Create: `src/components/ui/index.ts`

- [ ] **Step 1: Create barrel**

Create `src/components/ui/index.ts`:

```ts
export { KpiCard } from "./KpiCard";
export type { KpiCardProps, KpiTone } from "./KpiCard";
export { Tabs } from "./Tabs";
export type { TabsProps, TabItem } from "./Tabs";
export { Stepper } from "./Stepper";
export type { StepperProps, StepperItem, StepStatus } from "./Stepper";
export { DropZone } from "./DropZone";
export type { DropZoneProps } from "./DropZone";
export { FilterBar } from "./FilterBar";
export type { FilterBarProps, FilterGroup, FilterOption } from "./FilterBar";
```

- [ ] **Step 2: Full quality gate**

Run: `npm run lint && npm run test && npm run build`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/index.ts
git commit -m "feat(ui): add ui primitives barrel export"
```

---

## Self-Review

- All 5 primitives + ErrorBoundary + token block covered. No TBDs.
- Type names consistent across tasks (`KpiTone`, `StepStatus`, `FilterGroup`).
- Each task ends with green tests and a commit.
- No breaking changes to existing screens — Spec 1/2/3 can now safely consume `@/components/ui`.
