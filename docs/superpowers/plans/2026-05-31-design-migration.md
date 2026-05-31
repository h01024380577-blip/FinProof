# Design Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `choi0312/FinProof-AI-Agent` 레퍼런스 레포의 디자인을 현재 코드베이스에 적용한다. 모든 기존 기능(채팅 위젯, 이미지 뷰어, persistReviewer, 삭제 기능)은 유지한다.

**Architecture:** globals.css를 레퍼런스 버전(10K줄)으로 교체하고 채팅 위젯 전용 스타일(현재 코드베이스에만 존재)을 append한다. 새 에셋(SVG 로고), 랜딩 컴포넌트, AppShell을 레퍼런스 버전으로 교체하고, ReviewQueue·KnowledgeDocumentRegistry는 레퍼런스 JSX 구조에 현재 기능 로직을 병합한다.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, lucide-react, CSS custom properties

**Reference repo path:** `/tmp/finproof-reference`

---

## File Map

| 파일 | 작업 |
|------|------|
| `public/finproof-logo.svg` | 신규 — 레퍼런스 복사 |
| `public/finproof-mark.svg` | 신규 — 레퍼런스 복사 |
| `src/app/globals.css` | 교체 — 레퍼런스 버전 + 현재 채팅 위젯 스타일 append |
| `src/app/landing-refresh.css` | 신규 — 레퍼런스 복사 |
| `src/app/layout.tsx` | 수정 — landing-refresh.css import 추가, metadata 업데이트 |
| `src/app/page.tsx` | 교체 — 레퍼런스 버전 |
| `src/components/LandingServiceFlow.tsx` | 신규 — 레퍼런스 복사 |
| `src/components/AppShell.tsx` | 교체 — 레퍼런스 버전 |
| `src/components/ReviewQueue.tsx` | 병합 — 레퍼런스 consoleModules 섹션 + 현재 persistReviewer 로직 |
| `src/components/KnowledgeDocumentRegistry.tsx` | 병합 — 레퍼런스 JSX + 현재 delete 기능 |

---

## Task 1: 에셋 복사 및 public/ 디렉토리 설정

**Files:**
- Create: `public/finproof-logo.svg`
- Create: `public/finproof-mark.svg`

- [ ] **Step 1: public 디렉토리 생성 및 SVG 복사**

```bash
mkdir -p /Users/jiwon/Desktop/FinProof_Agent/public
cp /tmp/finproof-reference/public/finproof-logo.svg /Users/jiwon/Desktop/FinProof_Agent/public/
cp /tmp/finproof-reference/public/finproof-mark.svg /Users/jiwon/Desktop/FinProof_Agent/public/
ls /Users/jiwon/Desktop/FinProof_Agent/public/
```

Expected output:
```
finproof-logo.svg  finproof-mark.svg
```

- [ ] **Step 2: 커밋**

```bash
git add public/
git commit -m "feat: add finproof logo and mark SVG assets"
```

---

## Task 2: globals.css 교체 (레퍼런스 + 채팅 위젯 스타일 병합)

**Files:**
- Modify: `src/app/globals.css`

현재 globals.css의 채팅 위젯 전용 스타일(레퍼런스에 없는 `.chat-composer`, `.chat-widget*`, `.chat-launcher*`)을 레퍼런스 CSS 뒤에 append한다.

- [ ] **Step 1: 레퍼런스 globals.css를 복사하고 채팅 스타일 append**

```bash
cp /tmp/finproof-reference/src/app/globals.css /Users/jiwon/Desktop/FinProof_Agent/src/app/globals.css

# 현재 코드베이스에서 채팅 위젯 전용 스타일 추출 (git show로 원본 가져오기)
git show HEAD:src/app/globals.css | sed -n '1692,2940p' >> /Users/jiwon/Desktop/FinProof_Agent/src/app/globals.css
```

- [ ] **Step 2: 줄 수 확인 (10K+ 이어야 함)**

```bash
wc -l /Users/jiwon/Desktop/FinProof_Agent/src/app/globals.css
```

Expected: 12000줄 이상

- [ ] **Step 3: 핵심 클래스 존재 확인**

```bash
grep -c "chat-launcher\|chat-widget\|landing-hero\|app-shell\|sidebar" /Users/jiwon/Desktop/FinProof_Agent/src/app/globals.css
```

Expected: 30 이상

- [ ] **Step 4: landing-refresh.css 복사**

```bash
cp /tmp/finproof-reference/src/app/landing-refresh.css /Users/jiwon/Desktop/FinProof_Agent/src/app/landing-refresh.css
wc -l /Users/jiwon/Desktop/FinProof_Agent/src/app/landing-refresh.css
```

Expected: 328줄

- [ ] **Step 5: 커밋**

```bash
git add src/app/globals.css src/app/landing-refresh.css
git commit -m "feat: replace globals.css with reference design system, add landing-refresh.css"
```

---

## Task 3: layout.tsx 업데이트

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: layout.tsx 수정**

`src/app/layout.tsx`를 다음으로 교체:

```tsx
import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { RoleProvider } from "@/components/RoleContext";
import "./globals.css";
import "./landing-refresh.css";

export const metadata: Metadata = {
  title: "FinProof Agent",
  description: "검토는 빠르게, 판단은 정확하게. Review Faster. Decide Smarter."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        <RoleProvider>
          <Suspense fallback={null}>
            <AppShell>{children}</AppShell>
          </Suspense>
        </RoleProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: 빌드 확인**

```bash
npm run build 2>&1 | tail -5
```

Expected: `✓ Generating static pages` (에러 없음)

- [ ] **Step 3: 커밋**

```bash
git add src/app/layout.tsx
git commit -m "feat: add landing-refresh.css import and update metadata"
```

---

## Task 4: LandingServiceFlow 컴포넌트 추가

**Files:**
- Create: `src/components/LandingServiceFlow.tsx`

- [ ] **Step 1: LandingServiceFlow.tsx 복사**

```bash
cp /tmp/finproof-reference/src/components/LandingServiceFlow.tsx /Users/jiwon/Desktop/FinProof_Agent/src/components/LandingServiceFlow.tsx
```

- [ ] **Step 2: 타입 검사**

```bash
npx tsc --noEmit 2>&1 | grep "LandingServiceFlow" | head -5
```

Expected: 출력 없음 (에러 없음)

- [ ] **Step 3: 커밋**

```bash
git add src/components/LandingServiceFlow.tsx
git commit -m "feat: add LandingServiceFlow component from reference design"
```

---

## Task 5: 랜딩 페이지 교체 (page.tsx)

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: page.tsx를 레퍼런스 버전으로 교체**

```bash
cp /tmp/finproof-reference/src/app/page.tsx /Users/jiwon/Desktop/FinProof_Agent/src/app/page.tsx
```

- [ ] **Step 2: 타입 검사 및 빌드 확인**

```bash
npx tsc --noEmit 2>&1 | grep -v "baseUrl" | head -10
```

Expected: 출력 없음

- [ ] **Step 3: 커밋**

```bash
git add src/app/page.tsx
git commit -m "feat: replace landing page with reference design (hero + service flow + CTA)"
```

---

## Task 6: AppShell 교체

**Files:**
- Modify: `src/components/AppShell.tsx`

레퍼런스 AppShell의 주요 변경:
- `Image` (`next/image`)로 로고 표시 (`/finproof-logo.svg`)
- `pathname === "/"` 일 때 shell 없이 children만 렌더 (랜딩 전용 레이아웃)
- sidebar slogan `Review Faster. Decide Smarter.` 블록 추가
- sidebar section label `Console` 추가
- topbar: Bell / Settings / UserCircle 아이콘 버튼 추가
- topbar slogan (`ShieldCheck` + `검토는 빠르게, 판단은 정확하게`) 추가

- [ ] **Step 1: AppShell.tsx를 레퍼런스 버전으로 교체**

```bash
cp /tmp/finproof-reference/src/components/AppShell.tsx /Users/jiwon/Desktop/FinProof_Agent/src/components/AppShell.tsx
```

- [ ] **Step 2: 타입 검사**

```bash
npx tsc --noEmit 2>&1 | grep -v "baseUrl" | head -10
```

Expected: 출력 없음

- [ ] **Step 3: 빌드 확인**

```bash
npm run build 2>&1 | tail -8
```

Expected: `✓ Generating static pages` (에러 없음)

- [ ] **Step 4: 커밋**

```bash
git add src/components/AppShell.tsx
git commit -m "feat: upgrade AppShell with logo image, sidebar slogan, topbar icons"
```

---

## Task 7: ReviewQueue 병합 (consoleModules + persistReviewer 유지)

**Files:**
- Modify: `src/components/ReviewQueue.tsx`

레퍼런스 ReviewQueue에서 `consoleModules` 배열과 렌더 섹션을 가져오고,
현재 코드베이스의 `persistReviewer`, `savingReviewerIds`, AI 분석 담당자 prompt 로직을 유지한다.

- [ ] **Step 1: 레퍼런스 ReviewQueue.tsx를 시작점으로 복사**

```bash
cp /tmp/finproof-reference/src/components/ReviewQueue.tsx /Users/jiwon/Desktop/FinProof_Agent/src/components/ReviewQueue.tsx
```

- [ ] **Step 2: 현재 코드의 persistReviewer 로직 병합**

`src/components/ReviewQueue.tsx`를 열어 다음 항목이 없으면 추가한다:

**2a. imports 상단에 추가 (없으면):**
현재 코드의 `savingReviewerIds` state 및 `persistReviewer` 함수가 필요한 경우 레퍼런스 파일에 이미 있는지 확인:

```bash
grep -n "persistReviewer\|savingReviewerIds" /Users/jiwon/Desktop/FinProof_Agent/src/components/ReviewQueue.tsx
```

없으면: 현재 git에서 해당 로직을 추출해서 적절한 위치에 삽입한다.

**2b. state 선언 추가 (없으면):**
`useState` 선언 블록에 다음을 추가한다:
```tsx
const [savingReviewerIds, setSavingReviewerIds] = useState<string[]>([]);
```

**2c. `handleStartAnalysis` 함수에 reviewer prompt 로직 병합:**

레퍼런스의 `handleStartAnalysis`에는 prompt가 없다. 현재 코드의 로직으로 교체한다:

```tsx
async function handleStartAnalysis(review: ReviewSummary) {
  const promptedReviewer = window.prompt("AI 분석 담당자 이름을 입력해 주세요.", review.reviewer);

  if (promptedReviewer === null) {
    return;
  }

  const reviewer = promptedReviewer.trim();

  if (!reviewer) {
    setLoadError("AI 분석 담당자 이름을 입력해 주세요.");
    return;
  }

  setStartingAnalysisIds((current) =>
    current.includes(review.id) ? current : [...current, review.id]
  );

  let savedReviewer = review.reviewer;

  try {
    if (reviewer !== review.reviewer) {
      setSavingReviewerIds((current) =>
        current.includes(review.id) ? current : [...current, review.id]
      );
      savedReviewer = await persistReviewer(review, reviewer);
      setReviews((current) =>
        current.map((candidate) =>
          candidate.id === review.id ? { ...candidate, reviewer: savedReviewer } : candidate
        )
      );
      setSavingReviewerIds((current) => current.filter((id) => id !== review.id));
    }

    const apiResponse = await fetch(
      `/api/v1/review-cases/${encodeURIComponent(review.id)}/analysis/start`,
      {
        method: "POST",
        headers: roleContext?.apiHeaders(),
        body: JSON.stringify({ reviewer: savedReviewer })
      }
    );

    if (!apiResponse.ok) {
      throw new Error("분석 시작에 실패했습니다.");
    }

    setReviews((current) =>
      current.map((candidate) =>
        candidate.id === review.id
          ? { ...candidate, status: "analysis_waiting", reviewer: savedReviewer }
          : candidate
      )
    );
  } catch {
    setLoadError("분석 시작에 실패했습니다. 잠시 후 다시 시도해 주세요.");
  } finally {
    setStartingAnalysisIds((current) => current.filter((id) => id !== review.id));
  }
}
```

**2d. `persistReviewer` 함수 추가 (없으면):**

```tsx
async function persistReviewer(review: ReviewSummary, reviewer: string): Promise<string> {
  const apiResponse = await fetch(
    `/api/v1/review-cases/${encodeURIComponent(review.id)}`,
    {
      method: "PATCH",
      headers: { ...roleContext?.apiHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ reviewer })
    }
  );

  if (!apiResponse.ok) {
    return review.reviewer;
  }

  return reviewer;
}
```

- [ ] **Step 3: 타입 검사**

```bash
npx tsc --noEmit 2>&1 | grep -v "baseUrl" | head -10
```

Expected: 출력 없음

- [ ] **Step 4: 커밋**

```bash
git add src/components/ReviewQueue.tsx
git commit -m "feat: add consoleModules card grid to ReviewQueue, keep persistReviewer logic"
```

---

## Task 8: KnowledgeDocumentRegistry 병합 (레퍼런스 JSX + 현재 delete 기능)

**Files:**
- Modify: `src/components/KnowledgeDocumentRegistry.tsx`

현재 코드베이스에는 `deleteDocument` 기능 및 `Trash2` 아이콘이 있다. 레퍼런스에는 없다.

- [ ] **Step 1: 레퍼런스를 시작점으로 복사**

```bash
cp /tmp/finproof-reference/src/components/KnowledgeDocumentRegistry.tsx /Users/jiwon/Desktop/FinProof_Agent/src/components/KnowledgeDocumentRegistry.tsx
```

- [ ] **Step 2: delete 관련 imports 추가**

파일 상단 import에 `Trash2` 추가:
```tsx
import {
  BookOpenCheck,
  CheckCircle2,
  FileText,
  ShieldCheck,
  Trash2   // ← 추가
} from "lucide-react";
```

- [ ] **Step 3: KnowledgeDocumentDeleteResponse 타입 추가**

`KnowledgeDocumentAction` 타입 근처에 추가:
```tsx
type KnowledgeDocumentDeleteResponse = {
  deleted: boolean;
  documentId: string;
};
```

- [ ] **Step 4: pendingDocumentAction의 action union에 "delete" 추가**

```tsx
// 기존
action: "approve" | "unapprove";
// 변경 후
action: "approve" | "unapprove" | "delete";
```

- [ ] **Step 5: `deleteDocument` 함수 추가**

`approveDocument` 함수 뒤에 추가:

```tsx
async function deleteDocument(document: KnowledgeDocument): Promise<void> {
  if (!window.confirm(`${document.title} 지식문서를 삭제할까요?`)) {
    return;
  }

  setPendingDocumentAction({ documentId: document.id, action: "delete" });

  try {
    const response = await fetch(`/api/v1/knowledge-documents/${document.id}`, {
      method: "DELETE",
      headers: roleContext?.apiHeaders()
    });

    if (!response.ok) {
      setStatus("지식문서 삭제에 실패했습니다.");
      return;
    }

    const body = (await response.json()) as KnowledgeDocumentDeleteResponse;
    setDocuments((current) => current.filter((item) => item.id !== body.documentId));
    setStatus("삭제 완료");
  } finally {
    setPendingDocumentAction(null);
  }
}
```

- [ ] **Step 6: 문서 카드에 삭제 버튼 추가**

각 문서 카드의 액션 버튼 그룹에 삭제 버튼 추가:
```tsx
<button
  type="button"
  onClick={() => void deleteDocument(doc)}
  disabled={pendingDocumentAction?.documentId === doc.id}
  aria-label="삭제"
  title="삭제"
>
  <Trash2 size={15} aria-hidden="true" />
</button>
```

- [ ] **Step 7: 타입 검사**

```bash
npx tsc --noEmit 2>&1 | grep -v "baseUrl" | head -10
```

Expected: 출력 없음

- [ ] **Step 8: 커밋**

```bash
git add src/components/KnowledgeDocumentRegistry.tsx
git commit -m "feat: apply reference design to KnowledgeDocumentRegistry, keep delete feature"
```

---

## Task 9: 최종 빌드 & 린트 검증

- [ ] **Step 1: 전체 빌드**

```bash
npm run build 2>&1 | tail -15
```

Expected: `✓ Generating static pages` 및 에러 없음

- [ ] **Step 2: 린트 검사**

```bash
npm run lint 2>&1 | tail -10
```

Expected: `✔ No ESLint warnings or errors`

- [ ] **Step 3: 테스트 실행**

```bash
npm run test 2>&1 | tail -15
```

Expected: 기존 테스트 모두 pass

- [ ] **Step 4: EC2 배포**

```bash
# src 전체 동기화
rsync -az --exclude='.next' --exclude='node_modules' \
  /Users/jiwon/Desktop/FinProof_Agent/src/ \
  maeum-jungsan-personal:/opt/finproof-agent/current/src/

# public 에셋 동기화
rsync -az /Users/jiwon/Desktop/FinProof_Agent/public/ \
  maeum-jungsan-personal:/opt/finproof-agent/current/public/

# 서버 빌드 및 재시작
ssh maeum-jungsan-personal "cd /opt/finproof-agent/current && npm run build && sudo systemctl restart finproof-agent"
```

- [ ] **Step 5: 최종 커밋 및 푸시**

```bash
git push origin sprint-0
```
