# Roadmap

> 문서 용도: Demo MVP, Product V1 Pilot, Compliance Platform 단계별 제품 확장 계획을 정리한 로드맵입니다.


태그: #roadmap

## Phase 0. Demo MVP

목표: 대회 발표에서 제품 가치를 한 흐름으로 보여준다.

원칙: 실제 인프라보다 서비스 흐름 시연을 우선한다. 보안형 원커맨드 설치, 고객사 내부 storage, 실제 Vector DB/RAG 운영 파이프라인은 예선 통과 이후로 분리한다.

범위:

- 자료 패키지 업로드 UI
- 파일 자동 분류 결과 UI
- 대출 광고 샘플 1건
- 예금/적금 금리 광고 샘플 1건
- 위험 하이라이트
- 근거 패널
- RAG 채팅 시뮬레이션 또는 실제 검색
- 반려/수정 의견 초안 생성

완료 기준:

- 발표자가 3분 안에 핵심 사용자 흐름을 시연할 수 있다.
- 위험 지점, 근거, 의견 초안이 하나의 화면 흐름으로 연결된다.

## Phase 1. Product V1 Pilot

목표: 제한된 조직에서 실제 파일럿 심의 요청을 처리할 수 있다.

범위:

- 인증/권한
- 심의 요청 관리
- 실제 파일 업로드
- 고객사 내부 또는 private cloud Object Storage
- OCR/문서 파싱
- Vector DB 기반 RAG
- Relational DB 기반 이력 저장
- 과거 심의사례 RAG 확장 계획 수립 ([[04 Data AI/Future Plan - Case History RAG]])
- 감사 로그
- 리포트 다운로드

완료 기준:

- 준법심의자가 실제 홍보물 자료를 업로드하고 검토 결과를 저장할 수 있다.
- 이슈별 판단 이력이 다음 유사 심의에 검색된다.

## Phase 2. Compliance Platform

목표: 그룹·계열사 단위로 운영 가능한 준법심의 플랫폼으로 확장한다.

범위:

- 계열사별 정책 분리
- 내부 결재/그룹웨어 연동
- 규정 업데이트 모니터링 Agent
- 과거 심의사례 전문가 Agent 및 유사 사례 패널
- 심의번호 관리
- 다상품군 확장
- 심의 품질 대시보드
- 원커맨드 설치형 Private Agent App
- 고객사 내부 S3-compatible storage/Vector DB 운영
