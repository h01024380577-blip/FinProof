"use client";

import { useEffect, useRef, useState } from "react";
import {
  BookOpenCheck,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Highlighter,
  PackageOpen,
  Radar
} from "lucide-react";

type PreviewType = "intake" | "queue" | "analysis" | "evidence" | "report";

const serviceFlowSteps: Array<{
  title: string;
  label: string;
  description: string;
  value: string;
  preview: PreviewType;
  icon: typeof PackageOpen;
}> = [
  {
    title: "심의 요청 업로드",
    label: "Intake",
    description: "광고 시안, 상품 설명서, 금리표, 내부 체크리스트를 하나의 패키지로 등록합니다.",
    value: "자료 접수부터 누락 여부까지 한 번에 확인",
    preview: "intake",
    icon: PackageOpen
  },
  {
    title: "심의 대기열 정리",
    label: "Queue",
    description:
      "담당 부서, 위험도, 마감일, 검토 상태를 기준으로 오늘 처리할 심의 건을 정리합니다.",
    value: "업무 우선순위를 빠르게 파악",
    preview: "queue",
    icon: ClipboardCheck
  },
  {
    title: "AI 이슈 분석",
    label: "Analysis",
    description: "과장 표현, 필수 고지 누락, 오인 가능성이 있는 문구를 화면 위에 표시합니다.",
    value: "검토자가 봐야 할 지점을 먼저 제시",
    preview: "analysis",
    icon: Radar
  },
  {
    title: "근거 문서 연결",
    label: "Evidence",
    description: "내부 정책, 체크리스트, 법령, 과거 심의 사례를 판단 근거로 연결합니다.",
    value: "판단의 출처와 맥락을 함께 보관",
    preview: "evidence",
    icon: BookOpenCheck
  },
  {
    title: "보고서로 정리",
    label: "Report",
    description: "검토 이력, 주요 이슈, 수정 권고안, 근거 문서를 보고서 형태로 정리합니다.",
    value: "심의 의견 작성 시간을 줄이고 기록을 남김",
    preview: "report",
    icon: FileText
  }
];

function ServicePreview({ type }: { type: PreviewType }) {
  if (type === "intake") {
    return (
      <div className="service-preview service-preview--intake">
        <div className="service-preview__topbar">
          <strong>새 심의 요청</strong>
          <span>자료 4개 감지</span>
        </div>
        <div className="service-preview__drop">
          <PackageOpen size={26} aria-hidden="true" />
          <strong>광고 패키지 업로드</strong>
          <span>banner.png, product.pdf, checklist.xlsx</span>
        </div>
        <div className="service-preview__grid">
          <span>상품 유형: 예금</span>
          <span>담당 부서: 수신상품팀</span>
          <span>요청 마감: D-2</span>
        </div>
      </div>
    );
  }

  if (type === "queue") {
    return (
      <div className="service-preview service-preview--queue">
        <div className="service-preview__topbar">
          <strong>심의 대기 목록</strong>
          <span>오늘 신규 3건</span>
        </div>
        {[
          ["예금 상품 광고 배너", "AI 분석 중", "info"],
          ["대출 금리 안내 문구", "근거 확인 필요", "warning"],
          ["카드 혜택 랜딩 카피", "검토 완료", "success"]
        ].map(([title, status, tone]) => (
          <div className="service-preview-row" key={title}>
            <span>{title}</span>
            <strong data-tone={tone}>{status}</strong>
          </div>
        ))}
      </div>
    );
  }

  if (type === "analysis") {
    return (
      <div className="service-preview service-preview--analysis">
        <div className="service-preview__creative">
          <span>최대 연 7.2%</span>
          <strong>조건 없는 고금리 혜택</strong>
          <i className="service-preview__marker service-preview__marker--one" />
          <i className="service-preview__marker service-preview__marker--two" />
        </div>
        <div className="service-preview__issues">
          <strong>
            <Highlighter size={16} aria-hidden="true" />
            발견된 이슈
          </strong>
          <span>우대금리 조건 설명 부족</span>
          <span>원금 손실 가능성 고지 필요</span>
          <span>비교 표현 근거 확인 필요</span>
        </div>
      </div>
    );
  }

  if (type === "evidence") {
    return (
      <div className="service-preview service-preview--evidence">
        <div className="service-preview__topbar">
          <strong>근거 문서</strong>
          <span>정책 매칭 7건</span>
        </div>
        <div className="service-preview-doc" data-active="true">
          <BookOpenCheck size={17} aria-hidden="true" />
          <span>내부 광고 심의 기준 v3.2</span>
        </div>
        <div className="service-preview-doc">
          <BookOpenCheck size={17} aria-hidden="true" />
          <span>금융소비자보호 체크리스트</span>
        </div>
        <div className="service-preview-chat">
          “우대금리 조건은 배너 하단 고지와 상품설명서 4p를 함께 확인하세요.”
        </div>
      </div>
    );
  }

  return (
    <div className="service-preview service-preview--report">
      <div className="service-preview__topbar">
        <strong>심의 보고서</strong>
        <span>초안 생성 완료</span>
      </div>
      <div className="service-preview-report">
        <span>판단</span>
        <strong>수정 요청 권고</strong>
      </div>
      <div className="service-preview-checks">
        <span>
          <CheckCircle2 size={15} aria-hidden="true" />
          검토 이력 포함
        </span>
        <span>
          <CheckCircle2 size={15} aria-hidden="true" />
          근거 문서 5개 연결
        </span>
        <span>
          <CheckCircle2 size={15} aria-hidden="true" />
          수정 의견 초안 작성
        </span>
      </div>
    </div>
  );
}

export function LandingServiceFlow() {
  const sectionRef = useRef<HTMLElement | null>(null);
  const cardRefs = useRef<Array<HTMLElement | null>>([]);
  const [isVisible, setIsVisible] = useState(false);
  const [visibleIndexes, setVisibleIndexes] = useState<number[]>([]);

  useEffect(() => {
    const section = sectionRef.current;

    if (!section) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.18 }
    );

    observer.observe(section);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const cards = cardRefs.current.filter(Boolean) as HTMLElement[];

    if (!cards.length) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const index = Number(entry.target.getAttribute("data-flow-index"));

          if (!entry.isIntersecting || Number.isNaN(index)) {
            return;
          }

          setVisibleIndexes((current) => {
            if (current.includes(index)) {
              return current;
            }

            return [...current, index].sort((a, b) => a - b);
          });
        });
      },
      {
        rootMargin: "-18% 0px -24% 0px",
        threshold: 0.28
      }
    );

    cards.forEach((card) => observer.observe(card));

    return () => observer.disconnect();
  }, []);

  const visibleSet = new Set(visibleIndexes);

  return (
    <section
      className="service-flow-section service-flow-section--alternating"
      data-visible={isVisible}
      ref={sectionRef}
      aria-labelledby="service-flow-title"
    >
      <div className="service-flow-header">
        <div>
          <span className="service-flow-kicker">FinProof workflow</span>
          <h2 id="service-flow-title">심의 요청부터 보고서까지, 업무가 한 흐름으로 이어집니다</h2>
          <p>
            담당자가 실제로 마주하는 접수, 대기열, AI 분석, 근거 확인, 보고서 화면을 기준으로 검토
            과정을 구성했습니다.
          </p>
        </div>
      </div>

      <div className="service-flow-showcases" role="list" aria-label="FinProof 서비스 처리 단계">
        {serviceFlowSteps.map((step, index) => {
          const Icon = step.icon;
          const isStepVisible = visibleSet.has(index) || (isVisible && index === 0);
          const isReversed = index % 2 === 1;

          return (
            <article
              className="service-flow-showcase"
              data-flow-index={index}
              data-layout={isReversed ? "reversed" : "default"}
              data-visible={isStepVisible}
              key={step.title}
              ref={(node) => {
                cardRefs.current[index] = node;
              }}
              role="listitem"
            >
              <div className="service-flow-copy">
                <div className="service-flow-card__topline">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{step.label}</strong>
                </div>

                <div className="service-flow-card__body">
                  <div className="service-flow-card__icon" aria-hidden="true">
                    <Icon size={22} />
                  </div>

                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>

                <div className="service-flow-card__value">
                  <span>담당자가 확인하는 정보</span>
                  <strong>{step.value}</strong>
                </div>

                {index < serviceFlowSteps.length - 1 && (
                  <span className="service-flow-next-label">다음 단계로 연결</span>
                )}
              </div>

              <div className="service-flow-screen" aria-label={`${step.title} 서비스 화면`}>
                <div className="service-preview-shell">
                  <div className="service-preview-chrome">
                    <span />
                    <span />
                    <span />
                    <strong>finproof.app</strong>
                  </div>
                  <ServicePreview type={step.preview} />
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
