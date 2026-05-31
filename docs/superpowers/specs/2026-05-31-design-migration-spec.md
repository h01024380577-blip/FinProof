# FinProof Design Migration Spec
**Date:** 2026-05-31  
**Source repo:** https://github.com/choi0312/FinProof-AI-Agent.git  
**Goal:** 현재 코드베이스의 모든 기능을 유지하면서, 레퍼런스 레포의 디자인으로 교체한다.

---

## 1. 비교 요약

### 레퍼런스 레포가 현재 코드베이스보다 앞선 부분 (→ 적용)

| 영역 | 레퍼런스 | 현재 |
|------|----------|------|
| globals.css | 10,152줄 (풍부한 디자인 토큰, 세분화된 컴포넌트 스타일) | 3,453줄 |
| 랜딩페이지 (`/`) | hero + capabilities + LandingServiceFlow + final CTA | 단순 페이지 |
| AppShell | 로고 이미지, sidebar slogan, section label, topbar 아이콘 그룹 | 텍스트 브랜드, 미니멀 topbar |
| ReviewQueue | 모듈 카드 그리드(consoleModules) + 큐 테이블 | 큐 테이블만 |
| 에셋 | `/public/finproof-logo.svg`, `/public/finproof-mark.svg` | 없음 |
| LandingServiceFlow | 신규 컴포넌트 | 없음 |
| landing-refresh.css | 신규 CSS | 없음 |

### 현재 코드베이스에만 있는 기능 (→ 레퍼런스 디자인 언어 적용 후 유지)

| 기능 | 위치 |
|------|------|
| 채팅 플로팅 위젯 (isChatWidgetOpen, hasUnreadChatResponse) | ReviewDetailWorkspace |
| 업로드 크리에이티브 이미지 뷰어 (uploadedCreativeFile, objectUrl) | ReviewDetailWorkspace |
| CreativeViewer `creativeImage` prop | ReviewDetailWorkspace → CreativeViewer |
| files/[fileId]/content API 연동 | ReviewDetailWorkspace |
| AI 분석 담당자 변경 prompt (persistReviewer) | ReviewQueue |

---

## 2. 디자인 토큰 (레퍼런스 기준)

```css
:root {
  --primary: #003f7d;
  --primary-strong: #00346a;
  --primary-soft: #d8e5fb;
  --app-bg: #f5f5f6;
  --surface: #ffffff;
  --surface-muted: #f1f3f6;
  --text: #14181f;
  --text-soft: #343b49;
  --muted: #677083;
  --line: #c9ced8;
  /* spacing: 4px grid (--space-1 ~ --space-8) */
  /* radius: --radius-sm(4) --radius-md(8) --radius-lg(12) */
  /* font-size: xs(11) sm(13) base(14) lg(16) xl(20) 2xl(28) */
}
```

---

## 3. 마이그레이션 범위 및 작업 목록

### Phase 1: 에셋 & CSS 기반 교체
1. `public/finproof-logo.svg`, `public/finproof-mark.svg` 복사
2. `src/app/globals.css` → 레퍼런스 버전으로 교체  
   - 단, 현재에만 있는 채팅 위젯 스타일(`.chat-launcher`, `.chat-widget*`) 유지
3. `src/app/landing-refresh.css` 추가 및 layout.tsx에 import

### Phase 2: 신규 컴포넌트 추가
4. `LandingServiceFlow.tsx` 레퍼런스에서 복사
5. 랜딩페이지 `src/app/page.tsx` → 레퍼런스 버전으로 교체

### Phase 3: AppShell 디자인 업그레이드
6. `AppShell.tsx` → 레퍼런스 버전 적용
   - 로고 이미지 (`Image` from next/image)
   - sidebar slogan (`Review Faster. Decide Smarter.`)
   - sidebar section label `Console`
   - topbar: Bell / Settings / UserCircle 아이콘 버튼 추가
   - topbar slogan (`ShieldCheck` + 검토는 빠르게…)
   - pathname === "/" 일 때 shell 없이 children만 렌더 (랜딩 전용 레이아웃)

### Phase 4: ReviewQueue 디자인 업그레이드
7. `ReviewQueue.tsx` → 레퍼런스 consoleModules 카드 섹션 추가  
   - 현재에만 있는 `persistReviewer`, AI 분석 담당자 prompt 로직 유지
   - 카드 클릭 시 href로 이동하는 UI 추가

### Phase 5: ReviewDetailWorkspace 디자인 정합
8. `ReviewDetailWorkspace.tsx` → 레퍼런스 JSX 구조를 기반으로 정렬  
   - 채팅 위젯(isChatWidgetOpen, hasUnreadChatResponse) 현재 코드 유지
   - 크리에이티브 이미지 뷰어 현재 코드 유지
   - 레퍼런스에서 개선된 UI 구조(헤더, 이슈 리스트, 패널 레이아웃) 반영

### Phase 6: 나머지 컴포넌트 스타일 정합
9. `KnowledgeDocumentRegistry.tsx` - 레퍼런스 버전 구조 적용 (비즈니스 로직 동일하므로 JSX만 교체)
10. `QueueTable.tsx`, `QueueFilters.tsx`, `QueueMetrics.tsx` - 레퍼런스 클래스명/구조 반영
11. `workbench/` 하위 컴포넌트 - 레퍼런스 디자인 반영

---

## 4. 불변 조건 (절대 변경 금지)

- 모든 API 호출 로직 (`fetch`, `apiResponse`, `setChatResponsesByReviewId` 등)
- TypeScript 타입 시그니처 (`ReviewCase`, `ReviewIssue`, `ReviewStoreScope` 등)
- `server/`, `domain/`, `api/` 하위 파일 전체
- 채팅 위젯 unread 배지 로직 (`hasUnreadChatResponse`, `setHasUnreadChatResponse`)
- 업로드 이미지 뷰어 로직 (`uploadedCreativeFile`, `uploadedCreativeObject`)
- `persistReviewer` 로직 (ReviewQueue)

---

## 5. 검증 기준

- `npm run build` 타입 에러 0개
- `npm run lint` 경고 0개
- `npm run test` 기존 테스트 모두 통과
- 랜딩 → 심의 콘솔 → 심의 상세 → 채팅 → 지식문서 전체 UI 흐름 동작 확인
- 채팅 배지 unread 동작 유지 확인

---

## 6. 파일별 변경 분류

| 파일 | 작업 | 방식 |
|------|------|------|
| `public/finproof-logo.svg` | 신규 | 레퍼런스 복사 |
| `public/finproof-mark.svg` | 신규 | 레퍼런스 복사 |
| `src/app/globals.css` | 교체+병합 | 레퍼런스 기반 + 현재 채팅 스타일 유지 |
| `src/app/landing-refresh.css` | 신규 | 레퍼런스 복사 |
| `src/app/layout.tsx` | 수정 | landing-refresh.css import 추가 |
| `src/app/page.tsx` | 교체 | 레퍼런스 버전 |
| `src/components/LandingServiceFlow.tsx` | 신규 | 레퍼런스 복사 |
| `src/components/AppShell.tsx` | 교체 | 레퍼런스 버전 |
| `src/components/ReviewQueue.tsx` | 병합 | 레퍼런스 구조 + 현재 persistReviewer |
| `src/components/ReviewDetailWorkspace.tsx` | 병합 | 레퍼런스 JSX 구조 + 현재 기능 |
| `src/components/KnowledgeDocumentRegistry.tsx` | 교체 | 레퍼런스 버전 (로직 동일) |
| `src/components/queue/QueueTable.tsx` | 병합 | 레퍼런스 구조 기반 |
| `src/components/workbench/*.tsx` | 병합 | 레퍼런스 구조 기반 |
