# Spec 3 — New Review Request Refinement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `SamplePackageSelector.tsx` (新規 요청) into `intake/*` submodules using `Stepper`/`DropZone` primitives, with accurate step-state derivation, sticky CTA footer, and post-submit success state.

**Architecture:** `SamplePackageSelector.tsx` becomes a thin container owning form/upload state and the submission handler. Presentation lives in `IntakeStepper`, `IntakeMetaForm`, `IntakeUploadZone`, `IntakeClassificationPanel`, `IntakeRequiredMaterialsPanel`.

**Tech Stack:** Next.js 16, React 19, TypeScript.

**Depends on:** Spec 0 (`Stepper`, `DropZone`).

**Source spec:** `docs/superpowers/specs/2026-05-26-frontend-stitch-redesign-design.md` § Spec 3 + New Review Request section.

---

### Task 1: Extract `IntakeStepper` with state derivation

**Files:**
- Create: `src/components/intake/IntakeStepper.tsx`
- Create: `src/components/intake/IntakeStepper.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { IntakeStepper } from "./IntakeStepper";

describe("IntakeStepper", () => {
  it("marks meta as done when title present, upload as active when files empty", () => {
    render(<IntakeStepper hasTitle hasFiles={false} hasUploadResult={false} />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("data-status", "done");
    expect(items[1]).toHaveAttribute("data-status", "active");
    expect(items[2]).toHaveAttribute("data-status", "pending");
    expect(items[3]).toHaveAttribute("data-status", "pending");
  });

  it("marks all done once uploadResult exists", () => {
    render(<IntakeStepper hasTitle hasFiles hasUploadResult />);
    const items = screen.getAllByRole("listitem");
    expect(items.every((item) => item.getAttribute("data-status") === "done")).toBe(true);
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npm run test -- IntakeStepper`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/components/intake/IntakeStepper.tsx`:

```tsx
"use client";

import { Stepper, type StepStatus } from "@/components/ui";

export type IntakeStepperProps = {
  hasTitle: boolean;
  hasFiles: boolean;
  hasUploadResult: boolean;
};

function deriveStatuses({
  hasTitle,
  hasFiles,
  hasUploadResult
}: IntakeStepperProps): [StepStatus, StepStatus, StepStatus, StepStatus] {
  if (hasUploadResult) {
    return ["done", "done", "done", "done"];
  }
  if (hasFiles) {
    return [hasTitle ? "done" : "active", "done", "active", "pending"];
  }
  if (hasTitle) {
    return ["done", "active", "pending", "pending"];
  }
  return ["active", "pending", "pending", "pending"];
}

export function IntakeStepper(props: IntakeStepperProps): JSX.Element {
  const [meta, upload, check, submit] = deriveStatuses(props);
  return (
    <Stepper
      ariaLabel="신규 심의 요청 진행 단계"
      steps={[
        { key: "meta", label: "요청 메타", status: meta },
        { key: "upload", label: "자료 업로드", status: upload },
        { key: "check", label: "자동 분류 확인", status: check },
        { key: "submit", label: "제출 완료", status: submit }
      ]}
    />
  );
}
```

- [ ] **Step 4: Run tests + commit**

```bash
npm run test -- IntakeStepper
git add src/components/intake/IntakeStepper.tsx src/components/intake/IntakeStepper.test.tsx
git commit -m "feat(intake): add IntakeStepper with derived step states"
```

---

### Task 2: Extract `IntakeMetaForm`

**Files:**
- Create: `src/components/intake/IntakeMetaForm.tsx`
- Create: `src/components/intake/IntakeMetaForm.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntakeMetaForm, type IntakeMetaState } from "./IntakeMetaForm";

const baseState: IntakeMetaState = {
  title: "",
  affiliate: "광주은행",
  requestDepartment: "디지털마케팅팀",
  productType: "deposit",
  plannedPublishDate: "2026-06-20",
  channels: { mobile_app: true, website: false, offline: false },
  requestMemo: ""
};

describe("IntakeMetaForm", () => {
  it("fires onChange when title is typed", async () => {
    const onChange = vi.fn();
    render(<IntakeMetaForm state={baseState} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText(/심의 요청 제목/), "A");
    expect(onChange).toHaveBeenCalled();
    const lastCallArg = onChange.mock.calls.at(-1)?.[0];
    expect(lastCallArg.title).toBe("A");
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npm run test -- IntakeMetaForm`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/components/intake/IntakeMetaForm.tsx`:

```tsx
"use client";

import type { ProductType } from "@/domain/types";

export type IntakeChannelsState = { mobile_app: boolean; website: boolean; offline: boolean };

export type IntakeMetaState = {
  title: string;
  affiliate: string;
  requestDepartment: string;
  productType: ProductType;
  plannedPublishDate: string;
  channels: IntakeChannelsState;
  requestMemo: string;
};

export type IntakeMetaFormProps = {
  state: IntakeMetaState;
  onChange: (next: IntakeMetaState) => void;
};

export function IntakeMetaForm({ state, onChange }: IntakeMetaFormProps): JSX.Element {
  function patch(partial: Partial<IntakeMetaState>): void {
    onChange({ ...state, ...partial });
  }

  return (
    <div className="panel panel--compact intake-metadata-panel">
      <label className="intake-field intake-field--wide">
        <span>심의 요청 제목 *</span>
        <input
          aria-label="심의 요청 제목"
          placeholder="예: 광주은행 모바일 앱 신규 예금 상품 홍보물 심의"
          value={state.title}
          onChange={(event) => patch({ title: event.target.value })}
        />
      </label>

      <label className="intake-field">
        <span>계열사 *</span>
        <select
          aria-label="계열사"
          value={state.affiliate}
          onChange={(event) => patch({ affiliate: event.target.value })}
        >
          <option value="광주은행">광주은행</option>
          <option value="JB금융그룹">JB금융그룹</option>
          <option value="전북은행">전북은행</option>
        </select>
      </label>

      <label className="intake-field">
        <span>요청 부서 *</span>
        <input
          aria-label="요청 부서"
          value={state.requestDepartment}
          onChange={(event) => patch({ requestDepartment: event.target.value })}
        />
      </label>

      <label className="intake-field">
        <span>상품군 *</span>
        <select
          aria-label="상품군"
          value={state.productType}
          onChange={(event) => patch({ productType: event.target.value as ProductType })}
        >
          <option value="deposit">예금/적금</option>
          <option value="loan">대출</option>
          <option value="card">카드</option>
          <option value="investment">투자상품</option>
        </select>
      </label>

      <label className="intake-field">
        <span>게시 예정일 *</span>
        <input
          aria-label="게시 예정일"
          type="date"
          value={state.plannedPublishDate}
          onChange={(event) => patch({ plannedPublishDate: event.target.value })}
        />
      </label>

      <fieldset className="channel-fieldset">
        <legend>게시 채널</legend>
        {(
          [
            ["mobile_app", "모바일 앱"],
            ["website", "웹사이트"],
            ["offline", "오프라인"]
          ] as const
        ).map(([channel, label]) => (
          <label key={channel}>
            <input
              type="checkbox"
              checked={state.channels[channel]}
              onChange={(event) =>
                patch({
                  channels: { ...state.channels, [channel]: event.target.checked }
                })
              }
            />
            {label}
          </label>
        ))}
      </fieldset>

      <label className="intake-field intake-field--wide">
        <span>요청 메모</span>
        <textarea
          aria-label="요청 메모"
          value={state.requestMemo}
          onChange={(event) => patch({ requestMemo: event.target.value })}
        />
      </label>
    </div>
  );
}
```

- [ ] **Step 4: Run tests + commit**

```bash
npm run test -- IntakeMetaForm
git add src/components/intake/IntakeMetaForm.tsx src/components/intake/IntakeMetaForm.test.tsx
git commit -m "feat(intake): add IntakeMetaForm with state patcher"
```

---

### Task 3: Extract `IntakeUploadZone` using `DropZone`

**Files:**
- Create: `src/components/intake/IntakeUploadZone.tsx`

- [ ] **Step 1: Implement (no separate unit test — `DropZone` covers primitive behavior; integration tested via SamplePackageSelector)**

Create `src/components/intake/IntakeUploadZone.tsx`:

```tsx
"use client";

import { DropZone } from "@/components/ui";
import {
  formatUploadPolicySummary,
  uploadAcceptAttribute,
  validateUploadedFiles
} from "@/domain/upload-policy";

export type IntakeUploadZoneProps = {
  files: File[];
  onFilesChange: (files: File[]) => void;
  error?: string | null;
  onError: (message: string | null) => void;
};

export function IntakeUploadZone({
  files,
  onFilesChange,
  error,
  onError
}: IntakeUploadZoneProps): JSX.Element {
  function handleFilesSelected(selected: File[]): void {
    const next = [...files, ...selected];
    const validation = validateUploadedFiles(next);
    if (!validation.ok) {
      onError(validation.errors[0]);
      return;
    }
    onError(null);
    onFilesChange(next);
  }

  function handleRemove(index: number): void {
    const next = files.filter((_, currentIndex) => currentIndex !== index);
    onFilesChange(next);
    onError(null);
  }

  return (
    <>
      <DropZone
        accept={uploadAcceptAttribute}
        files={files}
        helperText="심의 대상 패키지를 업로드하세요 (ZIP, PDF, JPG)"
        error={error}
        onFilesSelected={handleFilesSelected}
        onRemoveFile={handleRemove}
      />
      <p className="upload-policy-note">{formatUploadPolicySummary()}</p>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/intake/IntakeUploadZone.tsx
git commit -m "feat(intake): add IntakeUploadZone wrapping DropZone primitive"
```

---

### Task 4: Extract `IntakeClassificationPanel`

**Files:**
- Create: `src/components/intake/IntakeClassificationPanel.tsx`

- [ ] **Step 1: Implement**

Create `src/components/intake/IntakeClassificationPanel.tsx`:

```tsx
"use client";

import { FileCheck2, Paperclip } from "lucide-react";
import type { ReviewFile } from "@/domain/types";

const fileTypeLabels: Record<string, string> = {
  promotional_creative: "홍보물 시안",
  copy_draft: "원문 카피",
  product_description: "상품 설명서",
  terms: "약관",
  rate_table: "금리표",
  checklist: "내부 체크리스트",
  internal_checklist: "내부 체크리스트",
  url_list: "URL 목록",
  package_archive: "압축 패키지",
  misc: "기타"
};

export type IntakeClassificationPanelProps = {
  files: ReviewFile[];
};

export function IntakeClassificationPanel({
  files
}: IntakeClassificationPanelProps): JSX.Element {
  return (
    <section className="panel panel--compact intake-check-panel">
      <div className="panel__header">
        <div>
          <h3>자동 분류 확인 (업로드 된 파일)</h3>
        </div>
        <FileCheck2 size={20} aria-hidden="true" />
      </div>

      <div className="classification-list">
        {files.length > 0 ? (
          files.map((file) => (
            <article key={file.id} className="classification-row">
              <Paperclip size={16} aria-hidden="true" />
              <div>
                <span>{fileTypeLabels[file.fileType] ?? file.fileType}</span>
                <strong>{file.name}</strong>
              </div>
              <em>{Math.round(file.classificationConfidence * 100)}%</em>
            </article>
          ))
        ) : (
          <article className="classification-row classification-row--empty">
            <Paperclip size={16} aria-hidden="true" />
            <div>
              <span>기타 첨부</span>
              <strong>-</strong>
            </div>
            <em>대기</em>
          </article>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/intake/IntakeClassificationPanel.tsx
git commit -m "feat(intake): extract IntakeClassificationPanel"
```

---

### Task 5: Extract `IntakeRequiredMaterialsPanel`

**Files:**
- Create: `src/components/intake/IntakeRequiredMaterialsPanel.tsx`

- [ ] **Step 1: Implement**

Create `src/components/intake/IntakeRequiredMaterialsPanel.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import type { RequiredMaterialRow } from "@/domain/intake";

const extraLabelMap: Record<string, string> = {
  promotional_creative: "홍보물 시안",
  copy_draft: "원문 카피",
  product_description: "상품 설명서",
  terms: "약관",
  rate_table: "금리표",
  checklist: "내부 체크리스트",
  internal_checklist: "내부 체크리스트",
  url_list: "URL 목록",
  package_archive: "압축 패키지",
  misc: "기타"
};

export type IntakeRequiredMaterialsPanelProps = {
  rows: RequiredMaterialRow[];
  extraMissingMaterials: string[];
  children?: ReactNode;
};

export function IntakeRequiredMaterialsPanel({
  rows,
  extraMissingMaterials,
  children
}: IntakeRequiredMaterialsPanelProps): JSX.Element {
  return (
    <section className="panel panel--compact intake-check-panel">
      <div className="panel__header">
        <div>
          <h3>누락된 필수 자료</h3>
        </div>
        <TriangleAlert size={20} aria-hidden="true" />
      </div>

      <div className="materials-grid">
        {rows.length > 0 ? (
          rows.map((row) => (
            <div key={row.fileType} className="material-row" data-status="missing">
              <TriangleAlert size={16} aria-hidden="true" />
              <span>{row.label}</span>
              <strong>보완 필요</strong>
            </div>
          ))
        ) : (
          <div className="material-row" data-status="present">
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>필수 자료</span>
            <strong>확인됨</strong>
          </div>
        )}
      </div>

      {extraMissingMaterials.length > 0 ? (
        <div className="missing-material-strip" aria-label="Additional missing materials">
          {extraMissingMaterials.map((material) => (
            <span key={material}>{extraLabelMap[material] ?? material}</span>
          ))}
        </div>
      ) : null}

      {children}
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/intake/IntakeRequiredMaterialsPanel.tsx
git commit -m "feat(intake): extract IntakeRequiredMaterialsPanel"
```

---

### Task 6: Refactor `SamplePackageSelector` to compose modules + sticky footer + post-submit state

**Files:**
- Modify: `src/components/SamplePackageSelector.tsx`
- Modify: `src/components/SamplePackageSelector.test.tsx` (selectors only if needed)
- Modify: `src/app/globals.css`

- [ ] **Step 1: Rewrite `SamplePackageSelector.tsx`**

Replace entire file:

```tsx
"use client";

import { type FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { getRequiredMaterialRows, type RequiredMaterialRow } from "@/domain/intake";
import type { ProductType, ReviewFile } from "@/domain/types";
import { IntakeStepper } from "./intake/IntakeStepper";
import { IntakeMetaForm, type IntakeMetaState } from "./intake/IntakeMetaForm";
import { IntakeUploadZone } from "./intake/IntakeUploadZone";
import { IntakeClassificationPanel } from "./intake/IntakeClassificationPanel";
import { IntakeRequiredMaterialsPanel } from "./intake/IntakeRequiredMaterialsPanel";

type UploadResult = {
  reviewCase: {
    id: string;
    title: string;
    productType: ProductType;
    status?: string;
  };
  files: ReviewFile[];
  missingMaterials: string[];
  analysisStartHref: string;
};

function inferFileType(fileName: string): ReviewFile["fileType"] {
  const normalized = fileName.toLocaleLowerCase("ko-KR");
  if (normalized.includes("terms") || normalized.includes("약관")) return "terms";
  if (
    normalized.includes("rate") ||
    normalized.includes("금리") ||
    normalized.endsWith(".xlsx") ||
    normalized.endsWith(".csv")
  )
    return "rate_table";
  if (normalized.includes("checklist") || normalized.includes("체크")) return "checklist";
  if (
    normalized.includes("description") ||
    normalized.includes("설명") ||
    normalized.includes("t&c")
  )
    return "product_description";
  if (normalized.includes("copy") || normalized.includes("카피")) return "copy_draft";
  return "promotional_creative";
}

function buildLocalFilePreview(files: File[]): ReviewFile[] {
  return files.map((file, index) => ({
    id: `local-file-${index + 1}`,
    name: file.name,
    fileType: inferFileType(file.name),
    classificationConfidence: 0.82,
    parseStatus: "pending",
    contentType: file.type,
    sizeBytes: file.size
  }));
}

function getRepresentedMissingKeys(materialRows: RequiredMaterialRow[]): Set<string> {
  return new Set(
    materialRows
      .filter((row) => row.status === "missing")
      .flatMap((row) => [
        row.fileType,
        row.fileType === "checklist" ? "internal_checklist" : row.fileType
      ])
  );
}

function getExtraMissingMaterials(
  missingMaterials: string[],
  materialRows: RequiredMaterialRow[]
): string[] {
  const represented = getRepresentedMissingKeys(materialRows);
  return missingMaterials.filter((material) => !represented.has(material));
}

const initialMeta: IntakeMetaState = {
  title: "",
  affiliate: "광주은행",
  requestDepartment: "디지털마케팅팀",
  productType: "deposit",
  plannedPublishDate: "2026-06-20",
  channels: { mobile_app: true, website: false, offline: false },
  requestMemo: "심의 시 특별히 검토가 필요한 부분을 작성해주세요."
};

export function SamplePackageSelector(): JSX.Element {
  const [meta, setMeta] = useState<IntakeMetaState>(initialMeta);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const localFilePreview = useMemo(() => buildLocalFilePreview(uploadFiles), [uploadFiles]);
  const classifiedFiles = uploadResult?.files ?? localFilePreview;
  const activeProductType = uploadResult?.reviewCase.productType ?? meta.productType;
  const materialRows = getRequiredMaterialRows({
    productType: activeProductType,
    files: classifiedFiles
  });
  const extraMissingMaterials = uploadResult
    ? getExtraMissingMaterials(uploadResult.missingMaterials, materialRows)
    : [];
  const missingMaterialRows = materialRows.filter((row) => row.status === "missing");

  async function submitUpload(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setUploadError(null);
    setUploadResult(null);

    if (uploadFiles.length === 0) {
      setUploadError("업로드할 파일을 선택해 주세요.");
      return;
    }

    const formData = new FormData();
    formData.set("title", meta.title);
    formData.set("affiliate", meta.affiliate);
    formData.set("productType", meta.productType);
    Object.entries(meta.channels)
      .filter(([, isSelected]) => isSelected)
      .forEach(([channel]) => formData.append("channelType", channel));
    formData.set("plannedPublishDate", meta.plannedPublishDate);
    formData.set("requestDepartment", meta.requestDepartment);
    formData.set("memo", meta.requestMemo);
    uploadFiles.forEach((file) => formData.append("files", file));

    setIsUploading(true);
    try {
      const response = await fetch("/api/v1/review-cases", {
        method: "POST",
        body: formData
      });
      if (!response.ok) throw new Error("업로드 요청을 처리하지 못했습니다.");
      setUploadResult((await response.json()) as UploadResult);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "업로드 요청을 처리하지 못했습니다.");
    } finally {
      setIsUploading(false);
    }
  }

  function resetForNextRequest(): void {
    setMeta(initialMeta);
    setUploadFiles([]);
    setUploadResult(null);
    setUploadError(null);
  }

  return (
    <div className="intake-flow">
      <div className="intake-title-row">
        <div>
          <h2>신규 심의 요청</h2>
        </div>
        <IntakeStepper
          hasTitle={meta.title.trim().length > 0}
          hasFiles={uploadFiles.length > 0}
          hasUploadResult={Boolean(uploadResult)}
        />
      </div>

      <form className="intake-reference-layout" onSubmit={submitUpload}>
        <section className="intake-main-column">
          <IntakeMetaForm state={meta} onChange={setMeta} />

          <IntakeUploadZone
            files={uploadFiles}
            onFilesChange={(next) => {
              setUploadFiles(next);
              setUploadResult(null);
            }}
            error={uploadError}
            onError={setUploadError}
          />
        </section>

        <aside className="intake-side-column">
          <IntakeClassificationPanel files={classifiedFiles} />
          <IntakeRequiredMaterialsPanel
            rows={missingMaterialRows}
            extraMissingMaterials={extraMissingMaterials}
          >
            <p className="intake-gate-note">
              Reviewer가 분석 시작 전 보완 요청 또는 제한적 분석 여부를 판단합니다.
            </p>
          </IntakeRequiredMaterialsPanel>
        </aside>

        <div className="intake-footer-bar">
          {uploadResult ? (
            <section className="submission-notice" aria-label="Submission status">
              <p>심의 큐에 분석 대기 건으로 등록되었습니다.</p>
              <Link className="button" href="/reviews">
                심의 큐에서 확인
              </Link>
              <button className="button" type="button" onClick={resetForNextRequest}>
                다른 요청 작성
              </button>
            </section>
          ) : (
            <button className="button button--primary upload-submit" type="submit" disabled={isUploading}>
              {isUploading ? "제출 중" : "심의 요청 제출"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Add sticky footer CSS**

Append to `src/app/globals.css`:

```css
.intake-footer-bar {
  position: sticky;
  bottom: 0;
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-5);
  background: var(--surface);
  border-top: 1px solid var(--line);
  box-shadow: var(--shadow-card);
}
.intake-footer-bar .submission-notice {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin: 0;
}
```

- [ ] **Step 3: Update existing tests if needed**

Run: `npm run test -- SamplePackageSelector`

If selectors that targeted the inline form changed, update them minimally. Notable: the form fields keep their `aria-label`s so most selectors should still resolve.

- [ ] **Step 4: Full quality gate**

Run: `npm run lint && npm run test && npm run build`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/components/SamplePackageSelector.tsx src/components/SamplePackageSelector.test.tsx \
        src/app/globals.css
git commit -m "refactor(intake): compose SamplePackageSelector from intake/* + sticky footer"
```

---

### Task 7: Stepper progression test in `SamplePackageSelector`

**Files:**
- Modify: `src/components/SamplePackageSelector.test.tsx`

- [ ] **Step 1: Add a test that walks through state changes**

Add this `describe` block at the bottom of the existing test file:

```tsx
describe("SamplePackageSelector stepper progression", () => {
  it("advances steps as the user fills meta and selects files", async () => {
    render(<SamplePackageSelector />);

    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("data-status", "active");

    const titleInput = screen.getByLabelText("심의 요청 제목");
    await userEvent.type(titleInput, "테스트 심의");

    const itemsAfterTitle = screen.getAllByRole("listitem");
    expect(itemsAfterTitle[0]).toHaveAttribute("data-status", "done");
    expect(itemsAfterTitle[1]).toHaveAttribute("data-status", "active");
  });
});
```

Ensure imports at the top of the file include `screen`, `render`, `userEvent`, and `describe`/`it`/`expect` from vitest (likely already present).

- [ ] **Step 2: Run test + commit**

```bash
npm run test -- SamplePackageSelector
git add src/components/SamplePackageSelector.test.tsx
git commit -m "test(intake): verify stepper advances on meta/upload progression"
```

---

### Task 8: Final dev-server smoke check

- [ ] **Step 1: Boot dev server**

Run: `npm run dev` (background) then `curl -sf http://localhost:3000/reviews/new -o /dev/null`. Confirm exit 0.

- [ ] **Step 2: Stop dev server.**

- [ ] **Step 3: Final lint + test + build**

Run: `npm run lint && npm run test && npm run build`
Expected: all green.

---

## Self-Review

- ✅ Spec § New Review Request → stepper state derivation (Task 1), two-column form with required indicators (Task 2), enlarged drop zone with file list (Task 3 via DropZone primitive), sticky right rail (Tasks 4/5 + existing layout CSS), sticky CTA footer (Task 6 CSS), post-submit dual CTAs (Task 6 render).
- ✅ Test coverage: stepper state unit + container progression integration.
- ✅ Type names consistent: `IntakeMetaState`, `IntakeChannelsState`.
- ✅ No placeholders.
