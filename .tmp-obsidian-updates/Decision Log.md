# Decision Log

> 문서 용도: 제품명, MVP 범위, Agent 구조, 데이터 구조 등 주요 의사결정을 모아 추적하는 결정 로그입니다.


태그: #decision

중요한 제품/기술 결정을 ADR 형태로 기록한다.

## 결정 목록

| ID | 날짜 | 결정 | 상태 | 링크 |
| --- | --- | --- | --- | --- |
| D-001 | 2026-05-25 | 제품명을 FinProof Agent로 확정 | Accepted | [[Decision 001 - Product Name]] |
| D-002 | 2026-05-25 | Demo MVP와 Product V1/Platform 범위 분리 | Accepted | [[Decision 002 - MVP Scope]] |
| D-003 | 2026-05-25 | 도메인 전문가 Sub Agent 구조 채택 | Accepted | [[Decision 003 - Domain Expert Agents]] |
| D-004 | 2026-05-25 | Vector DB, Relational DB, Object Storage 분리 | Accepted | [[Decision 004 - Data Storage Split]] |
| D-005 | 2026-05-25 | Demo MVP 기술 스택과 adapter-first 인프라 방향 확정 | Accepted | [[Decision 005 - Demo MVP Technical Stack and AWS Baseline]] |
| D-006 | 2026-05-25 | Demo MVP 입력 흐름은 샘플 패키지 선택 우선으로 구현 | Accepted | [[Decision 006 - Demo MVP Sample Package Intake]] |
| D-007 | 2026-05-25 | Sprint 0 컴포넌트 preview는 Next routes와 테스트로 대체 | Accepted | [[Decision 007 - Sprint 0 Component Preview]] |
| D-008 | 2026-05-25 | Demo MVP API boundary와 mock review store를 우선 구축 | Accepted | [[Decision 008 - Demo MVP API Boundary and Mock Review Store]] |
| D-009 | 2026-05-25 | Demo MVP 입력 목표를 샘플 패키지와 실제 파일 업로드 병행으로 수정 | Accepted | [[Decision 009 - Demo MVP Real File Upload Intake]] |
| D-010 | 2026-05-25 | Demo 실제 업로드 guardrail과 zip 처리 정책 확정 | Accepted | [[Decision 010 - Demo Upload Guardrails and Zip Policy]] |
| D-011 | 2026-05-25 | Demo MVP는 서비스 흐름 시연을 우선하고 Private Install은 예선 이후로 분리 | Accepted | [[Decision 011 - Demo MVP Flow First and Private Install Later]] |
| D-012 | 2026-05-25 | Demo MVP 리포트 다운로드는 Markdown 우선 구현 | Accepted | [[Decision 012 - Demo MVP Markdown Report Download]] |
| D-013 | 2026-05-25 | Demo MVP 의견 초안 저장과 버전 표시 정책 확정 | Accepted | [[Decision 013 - Demo MVP Opinion Draft Version Save]] |
| D-014 | 2026-05-25 | Dashboard 제거 및 Reviewer 전용 AI 분석 시작 흐름 확정 | Accepted | [[Decision 014 - Remove Dashboard and Gate Analysis Start]] |
| D-015 | 2026-05-25 | 8765 Quiet Compliance Workbench 구조를 최신 권한 흐름에 맞춰 채택 | Accepted | [[Decision 015 - Adopt 8765 Mockup Structure With Gated Analysis]] |
| D-016 | 2026-05-25 | 기본 gpt-5-mini와 고위험 상위 모델 승격 기반 AI 모델 라우팅 확정 | Accepted | [[Decision 016 - AI Model Routing Baseline]] |
| D-017 | 2026-05-27 | 유사사례 판단은 case_search Agent가 수행하고 체크리스트에는 ID/복사/열기만 최소 노출 | Accepted | [[Decision 017 - Case Search Agent Minimal Similar Case UX]] |

## 새 결정 기록 방법

1. [[07 Templates/Decision Record]]를 복사한다.
2. `08 Decisions` 폴더에 `Decision NNN - 제목.md`로 저장한다.
3. 위 표에 링크를 추가한다.
