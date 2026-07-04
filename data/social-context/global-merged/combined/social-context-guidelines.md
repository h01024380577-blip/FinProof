# FinProof Social Context KG Guidelines - Merged

## 운영 원칙

- 이 데이터는 금융 홍보물 사회적 맥락 리스크 사전 탐지용입니다.
- 고위험 결과는 자동 반려가 아니라 `hold` 및 Human-in-the-loop 검토로 연결합니다.
- 국가·지역·종교·왕실·역사·재난·정치 상징은 현지 담당자/준법/PR 검토가 필요합니다.

## Multicountry Guideline

# Social Context Risk Review Guidelines for Multi-Country Financial Promotions

## 1. 공통 심의 원칙

FinProof는 사회적 맥락 리스크를 단순 금지어로 탐지하지 않는다.
반드시 다음 조합을 함께 본다.

- 표현 또는 상징
- 날짜 또는 민감 사건
- 금융 홍보 문맥
- 상업성
- safe context
- 대상 고객 국가와 언어

## 2. 국가별 핵심 유의점

### Cambodia
- Khmer Rouge, Killing Fields, Tuol Sleng, S-21, Pol Pot, Year Zero를 금융 혜택 은유로 쓰지 않는다.
- Pchum Ben은 조상 추모 기간이므로 귀신·죽음·공양을 장난스러운 프로모션 소재로 쓰지 않는다.
- Angkor Wat, 국기, 불교, 국왕/왕실 상징은 존중 맥락만 허용한다.

### Vietnam
- April 30, Reunification Day, Fall of Saigon은 국내/디아스포라에 따라 해석이 다를 수 있다.
- Agent Orange, napalm, 전쟁 피해, 고엽제 표현은 금융 혜택·수익률 은유로 쓰지 않는다.
- Tet 프로모션은 가능하지만 가족·조상·도박·부채 조롱 표현은 피한다.

### Myanmar
- 2021 coup, Tatmadaw, CDM, three-finger salute, red ribbon은 정치적으로 매우 민감하다.
- Rohingya/Rakhine/난민 표현을 송금·대출·수수료 마케팅의 고정관념 소재로 쓰지 않는다.
- Thingyan 송금 프로모션은 가능하지만 종교·정치 상징과 결합하면 검토한다.

### China
- Taiwan, Chinese Taipei, Hong Kong, Tibet, Xinjiang, map/flag protocol은 고위험이다.
- Taiwan flag, country list, China map, separate-region 표현은 반드시 승인된 표기만 사용한다.
- Tiananmen/June Fourth/Tank Man은 금융 혜택·탱크·금리 은유와 결합하면 high/hold.
- Spring Festival, red envelope는 정상 프로모션 가능하나 도박·부채 조롱은 피한다.

### Thailand
- Monarchy, King, royal portrait, Article 112는 고위험. 금융상품명·캐시백·밈 소재로 쓰지 않는다.
- Buddha, monks, temples are sacred symbols; mascot/coupon/loan jokes are high risk.
- Songkran promotions are acceptable when respectful and family-oriented.
- Three-finger salute, coup, red/yellow political symbols are political risk signals.

## 3. 판단 정책

- `high`: PR/브랜드/준법 공동 검토를 위해 `hold` 권고.
- `caution`: 사람이 문맥을 확인해야 함.
- `info`: 안전 문맥이지만 로그에 남김.


## Korea Guideline

# FinProof 사회적 맥락 리스크 심의 가이드 v1

## 목적
본 가이드는 금융 홍보물에서 한국 사회의 민감 사건·집단·상징을 상업적 은유로 소비하거나 특정 집단을 비하하는 표현을 사전에 탐지하기 위한 내부 검수 기준이다.

## 핵심 원칙
1. 단어 단독 차단이 아니라 날짜·상징·대상집단·금융 홍보 문맥·상업성의 조합을 판단한다.
2. 고위험 판단은 KG 관계 경로와 ruleId를 함께 남긴다.
3. 추모·기부·교육·보도 등 안전 맥락은 별도 safe context로 관리한다.
4. AI는 최종 반려를 결정하지 않는다. high/caution 신호는 hold 또는 change_request 후보이며 최종 판단은 준법·PR·브랜드 담당자가 수행한다.

## 금융 홍보물에서 특히 주의할 조합
- 민감 참사일 + 참사 핵심 표현 + 금리/혜택/캐시백/수익률
- 민주화운동 기념일 + 군사·진압 상징 + 금융 이벤트
- 지역 비하 은어 + 금리/대출/카드 혜택
- 고인 조롱 밈 + 수익률/금리 하락 은유
- 식민지·군국주의 상징 + 카드 디자인/앱 배너
- 장애·세대·젠더·국적 비하 표현 + 금융상품 타깃팅

## 권장 조치
- high: 자동 승인 금지, hold, PR/브랜드/준법 공동 검토
- caution: 담당자 확인, 대체 표현 제안, 문맥 확인
- info: 추모·교육·기부·보도 등 안전 맥락일 경우 기록만 남기고 통과 가능
