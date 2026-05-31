import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  ClipboardCheck,
  FileSearch,
  FileText,
  Lock,
  PackageOpen,
  Radar
} from "lucide-react";
import { LandingReveal } from "@/components/LandingReveal";

const capabilityCards = [
  {
    title: "근거 문서 연결",
    label: "근거 문서 연결",
    description: "법령, 사내 기준, 상품자료, 과거 심의 사례를 심의 이슈와 같은 화면에서 연결합니다.",
    href: "/knowledge-documents",
    cta: "지식문서 관리하기",
    icon: BookOpenCheck
  },
  {
    title: "규제 변경 추적",
    label: "규제 추적",
    description: "최신 내부 정책과 체크리스트를 기준으로 검토 맥락을 유지하고 판단 누락을 줄입니다.",
    href: "/regulatory-sources",
    cta: "규제 변경 보기",
    icon: ClipboardCheck
  },
  {
    title: "심의 이슈 관리",
    label: "심의 이슈 관리",
    description: "과장, 오인, 필수 고지 누락 가능성이 있는 표현을 분류하고 후속 조치까지 관리합니다.",
    href: "/reviews",
    cta: "심의 콘솔 열기",
    icon: FileSearch
  }
];

const workflowSteps = [
  {
    num: "01",
    icon: PackageOpen,
    title: "심의 요청 업로드",
    desc: "배너, PDF, 금리표 등 광고 패키지를 한 번에 업로드합니다."
  },
  {
    num: "02",
    icon: ClipboardCheck,
    title: "심의 대기열 정리",
    desc: "상품군·위험도·마감일 기준으로 심의 건을 자동 정렬합니다."
  },
  {
    num: "03",
    icon: Radar,
    title: "AI 이슈 분석",
    desc: "과장·오인·필수 고지 누락 가능성을 자동으로 탐지합니다."
  },
  {
    num: "04",
    icon: BookOpenCheck,
    title: "근거 문서 연결",
    desc: "관련 법령과 내부 기준을 이슈 옆에 바로 연결합니다."
  },
  {
    num: "05",
    icon: FileText,
    title: "보고서 정리",
    desc: "검토 결과와 근거를 정리해 심의 보고서로 내보냅니다."
  }
];

const heroHighlights = ["심의 요청", "AI 이슈 분석", "근거 확인", "보고서 정리"];

const queueRows = [
  {
    id: "FP-2024-089",
    title: "예금 상품 광고 배너",
    product: "예금/적금",
    statusLabel: "분석완료",
    statusTone: "info",
    riskLabel: "높음",
    riskTone: "high",
    due: "D-2",
    action: "primary",
    actionLabel: "검토하기"
  },
  {
    id: "FP-2024-088",
    title: "대출 금리 안내 문구",
    product: "대출",
    statusLabel: "검토중",
    statusTone: "caution",
    riskLabel: "주의",
    riskTone: "caution",
    due: "D-5",
    action: "ghost",
    actionLabel: "상세보기"
  },
  {
    id: "FP-2024-087",
    title: "카드 혜택 랜딩 카피",
    product: "카드",
    statusLabel: "승인",
    statusTone: "success",
    riskLabel: "정보",
    riskTone: "info",
    due: "D-8",
    action: "dash",
    actionLabel: "—"
  }
] as const;

export default function HomePage() {
  return (
    <main className="landing-page">
      <LandingReveal />

      {/* NAV */}
      <nav className="lp-nav">
        <div className="lp-nav-inner">
          <Link className="lp-brand" href="/" aria-label="FinProof 홈">
            <Image
              src="/finproof-mark.svg"
              alt=""
              width={18}
              height={18}
              priority
              className="lp-brand-mark"
            />
            <span className="lp-brand-name">FinProof</span>
          </Link>
          <div className="lp-nav-links">
            <Link href="/reviews">심의 콘솔</Link>
            <Link href="/knowledge-documents">지식문서</Link>
            <Link href="/regulatory-sources">규제 변경</Link>
          </div>
          <Link className="lp-nav-cta" href="/reviews">
            시작하기
          </Link>
        </div>
      </nav>

      {/* HERO */}
      <section className="lp-hero" aria-labelledby="lp-hero-title">
        <div className="lp-hero-inner">
          <span className="lp-pill reveal">금융 광고 심의 AI 어시스턴트</span>
          <h1 id="lp-hero-title" className="reveal">
            금융 광고 심의를
            <br />
            한 화면에서 끝까지
          </h1>
          <p className="lp-hero-sub reveal">
            심의 요청, AI 이슈 분석, 근거 문서 연결, 보고서 정리를 하나의 워크스페이스에서 이어서
            처리하세요.
          </p>
          <div className="lp-cta-row reveal">
            <Link className="lp-btn lp-btn--primary" href="/reviews">
              심의 시작하기
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link className="lp-btn lp-btn--secondary" href="/knowledge-documents">
              지식문서 관리하기
            </Link>
          </div>
          <div className="lp-trust-row reveal" aria-label="FinProof 핵심 기능">
            {heroHighlights.map((item) => (
              <span className="lp-trust-item" key={item}>
                <CheckCircle2 size={16} aria-hidden="true" />
                {item}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* CONSOLE PREVIEW */}
      <section className="lp-preview" aria-label="실제 심의 화면 미리보기">
        <div className="lp-preview-inner">
          <p className="lp-eyebrow reveal">실제 심의 화면</p>
          <div className="lp-browser reveal">
            <div className="lp-browser-bar">
              <div className="lp-dots" aria-hidden="true">
                <span className="lp-dot lp-dot--r" />
                <span className="lp-dot lp-dot--y" />
                <span className="lp-dot lp-dot--g" />
              </div>
              <div className="lp-url-bar" aria-hidden="true">
                <Lock size={11} />
                finproof.app/reviews
              </div>
            </div>
            <div className="lp-table-wrap">
              <table className="lp-queue" aria-label="심의 대기 목록 예시">
                <thead>
                  <tr>
                    <th>심의 ID</th>
                    <th>제목</th>
                    <th>상품군</th>
                    <th>상태</th>
                    <th>위험도</th>
                    <th>마감일</th>
                    <th>작업</th>
                  </tr>
                </thead>
                <tbody>
                  {queueRows.map((row) => (
                    <tr key={row.id}>
                      <td className="lp-cell-id">{row.id}</td>
                      <td className="lp-cell-title">{row.title}</td>
                      <td>{row.product}</td>
                      <td>
                        <span className={`lp-badge lp-badge--${row.statusTone}`}>
                          {row.statusLabel}
                        </span>
                      </td>
                      <td>
                        <span className={`lp-badge lp-badge--${row.riskTone}`}>
                          {row.riskLabel}
                        </span>
                      </td>
                      <td className="lp-cell-due">{row.due}</td>
                      <td>
                        {row.action === "dash" ? (
                          <span className="lp-row-dash">—</span>
                        ) : (
                          <span className={`lp-row-btn lp-row-btn--${row.action}`}>
                            {row.actionLabel}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* CAPABILITY CARDS */}
      <section className="lp-cards" aria-label="FinProof 제품 범위">
        <div className="lp-cards-inner">
          <div className="lp-cards-grid">
            {capabilityCards.map((card) => {
              const Icon = card.icon;
              return (
                <div className="lp-cap-card reveal" key={card.title}>
                  <div className="lp-cap-top">
                    <span className="lp-pill">{card.label}</span>
                    <Icon size={20} aria-hidden="true" />
                  </div>
                  <h3 className="lp-cap-title">{card.title}</h3>
                  <p className="lp-cap-desc">{card.description}</p>
                  <Link className="lp-cap-link" href={card.href}>
                    → {card.cta}
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="lp-how" aria-labelledby="lp-how-title">
        <div className="lp-how-inner">
          <div className="lp-section-head reveal">
            <h2 id="lp-how-title">심의 요청부터 보고서까지, 한 흐름으로</h2>
            <p>업로드부터 보고서 정리까지 끊김 없이 이어지는 5단계 워크플로우.</p>
          </div>
          <div className="lp-steps reveal">
            {workflowSteps.map((step, i) => {
              const Icon = step.icon;
              return (
                <div className="lp-step-cell" key={step.num}>
                  {i > 0 && (
                    <div className="lp-step-arrow" aria-hidden="true">
                      <ArrowRight size={18} />
                    </div>
                  )}
                  <div className="lp-step">
                    <span className="lp-step-num">{step.num}</span>
                    <span className="lp-step-icon">
                      <Icon size={20} aria-hidden="true" />
                    </span>
                    <h3 className="lp-step-title">{step.title}</h3>
                    <p className="lp-step-desc">{step.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA BAND */}
      <section className="lp-cta-band" aria-labelledby="lp-cta-title">
        <div className="lp-cta-band-inner">
          <h2 id="lp-cta-title" className="reveal">
            스마트한 심의 업무를 위한
            <br />
            AI 컴플라이언스 어시스턴트
          </h2>
          <p className="reveal">
            반복되는 심의 업무를 줄이고, 근거 기반의 일관된 판단을 한 화면에서 이어가세요.
          </p>
          <div className="lp-cta-band-row reveal">
            <Link className="lp-btn lp-btn--invert" href="/reviews">
              심의 시작하기
            </Link>
            <Link className="lp-btn lp-btn--outline" href="/reviews">
              도입 문의하기
            </Link>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <span>FinProof © 2025</span>
          <div className="lp-footer-links">
            <Link href="#">개인정보처리방침</Link>
            <Link href="#">이용약관</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
