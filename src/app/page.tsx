import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  ClipboardCheck,
  FileSearch
} from "lucide-react";
import { LandingServiceFlow } from "@/components/LandingServiceFlow";

const capabilityCards = [
  {
    title: "근거 문서 연결",
    label: "Evidence workspace",
    description: "법령, 사내 기준, 상품자료, 과거 심의 사례를 심의 이슈와 같은 화면에서 연결합니다.",
    helper: "지식문서 관리하기",
    href: "/knowledge-documents",
    icon: BookOpenCheck
  },
  {
    title: "내부 정책 추적",
    label: "Policy control",
    description: "최신 내부 정책과 체크리스트를 기준으로 검토 맥락을 유지하고 판단 누락을 줄입니다.",
    helper: "대시보드 보기",
    href: "/dashboard",
    icon: ClipboardCheck
  },
  {
    title: "심의 이슈 관리",
    label: "Issue review",
    description: "과장, 오인, 필수 고지 누락 가능성이 있는 표현을 분류하고 후속 조치까지 관리합니다.",
    helper: "심의 콘솔 열기",
    href: "/reviews",
    icon: FileSearch
  }
];

const heroHighlights = ["심의 요청", "AI 이슈 분석", "근거 확인", "보고서 정리"];

export default function HomePage() {
  return (
    <main className="landing-page">
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="hero-flow-bg" aria-hidden="true">
          <span className="hero-gradient-mesh" />
          <span className="hero-liquid-river hero-liquid-river--one" />
          <span className="hero-liquid-river hero-liquid-river--two" />
          <span className="hero-liquid-river hero-liquid-river--three" />
          <span className="hero-ripple-stream hero-ripple-stream--one" />
          <span className="hero-ripple-stream hero-ripple-stream--two" />
          <span className="hero-glow-orb hero-glow-orb--blue" />
          <span className="hero-glow-orb hero-glow-orb--cyan" />
          <span className="hero-glow-orb hero-glow-orb--violet" />
          <span className="hero-wave-layer hero-wave-layer--primary" />
          <span className="hero-wave-layer hero-wave-layer--secondary" />
          <span className="hero-wave-layer hero-wave-layer--tertiary" />
          <span className="hero-flow-sheen" />
        </div>

        <header className="landing-nav animate-nav-fade-in">
          <Link className="landing-brand" href="/" aria-label="FinProof landing home">
            <span className="landing-brand__mark" aria-hidden="true">
              <Image src="/finproof-mark.svg" alt="" width={26} height={26} priority />
            </span>
            <strong>FinProof</strong>
          </Link>

          <nav className="landing-nav__links" aria-label="주요 화면">
            <Link href="/reviews">심의 콘솔</Link>
            <Link href="/knowledge-documents">지식문서</Link>
            <Link href="/dashboard">대시보드</Link>
          </nav>

          <Link className="landing-nav__cta" href="/reviews">
            시작하기
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </header>

        <div className="landing-hero__copy">
          <h1 id="landing-title" className="animate-fade-up" style={{ animationDelay: "140ms" }}>
            <span>금융 광고 심의를</span>
            <span>한 화면에서 끝까지</span>
          </h1>
          <p className="landing-english animate-fade-up" style={{ animationDelay: "260ms" }}>
            Review Faster. Decide Smarter.
          </p>
          <p className="landing-subtitle animate-fade-up" style={{ animationDelay: "380ms" }}>
            심의 요청, AI 이슈 분석, 근거 문서 연결, 보고서 정리를 하나의 워크스페이스에서 이어서
            처리하세요.
          </p>

          <div className="landing-actions animate-fade-up" style={{ animationDelay: "500ms" }}>
            <Link className="landing-button landing-button--primary" href="/reviews">
              심의 시작하기
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <Link className="landing-button landing-button--secondary" href="/knowledge-documents">
              지식문서 관리하기
            </Link>
          </div>

          <div
            className="landing-trust-row animate-fade-up"
            style={{ animationDelay: "620ms" }}
            aria-label="FinProof 핵심 기능"
          >
            {heroHighlights.map((signal) => (
              <span key={signal}>
                <CheckCircle2 size={16} aria-hidden="true" />
                {signal}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-capabilities" aria-label="FinProof 제품 범위">
        {capabilityCards.map((card, index) => {
          const Icon = card.icon;

          return (
            <article
              className="landing-capability-card animate-fade-up"
              key={card.title}
              style={{ animationDelay: `${720 + index * 110}ms` }}
            >
              <div className="landing-capability-card__top">
                <span>{card.label}</span>
                <div className="landing-capability-card__icon" aria-hidden="true">
                  <Icon size={20} />
                </div>
              </div>
              <strong>{card.title}</strong>
              <p>{card.description}</p>
              <Link href={card.href}>
                {card.helper}
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </article>
          );
        })}
      </section>

      <LandingServiceFlow />

      <section className="landing-final-cta" aria-labelledby="landing-final-title">
        <span className="landing-final-cta__glow landing-final-cta__glow--blue" aria-hidden="true" />
        <span className="landing-final-cta__glow landing-final-cta__glow--cyan" aria-hidden="true" />
        <div className="landing-final-cta__content">
          <span className="landing-final-cta__eyebrow">Start FinProof</span>
          <h2 id="landing-final-title">스마트한 심의 업무를 위한 AI 컴플라이언스 어시스턴트.</h2>
          <p>
            근거 문서와 내부 정책, 심의 이슈를 한 흐름으로 연결해 검토자는 더 빠르게 확인하고
            더 정확하게 판단할 수 있습니다.
          </p>
          <div className="landing-final-cta__actions">
            <Link className="landing-button landing-button--primary" href="/reviews">
              심의 시작하기
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <Link className="landing-button landing-button--secondary" href="/knowledge-documents">
              지식문서 관리하기
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
