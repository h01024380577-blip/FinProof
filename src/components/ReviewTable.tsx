import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getReviewSummaries } from "@/domain/reviews";
import { RiskBadge, StatusBadge } from "./Badges";

const productLabels = {
  deposit: "예금/적금",
  loan: "대출",
  card: "카드",
  capital: "캐피탈",
  insurance: "보험",
  investment: "투자상품",
  image_test: "이미지 테스트"
};

export function ReviewTable() {
  const reviews = getReviewSummaries();

  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Review Queue</p>
          <h2>심의 요청 목록</h2>
        </div>
        <Link className="button button--primary" href="/reviews/new">
          새 심의 요청
        </Link>
      </div>

      <div className="review-table" role="table" aria-label="Review cases">
        <div className="review-table__row review-table__row--head" role="row">
          <span role="columnheader">요청 ID</span>
          <span role="columnheader">제목</span>
          <span role="columnheader">상품군</span>
          <span role="columnheader">계열사</span>
          <span role="columnheader">상태</span>
          <span role="columnheader">위험도</span>
          <span role="columnheader">담당자</span>
          <span role="columnheader">게시 예정</span>
          <span role="columnheader" aria-label="Open" />
        </div>
        {reviews.map((review) => (
          <Link
            key={review.id}
            className="review-table__row"
            href={`/reviews/${review.id}`}
            role="row"
          >
            <span role="cell">{review.id}</span>
            <strong role="cell">{review.title}</strong>
            <span role="cell">{productLabels[review.productType]}</span>
            <span role="cell">{review.affiliate}</span>
            <span role="cell">
              <StatusBadge status={review.status} />
            </span>
            <span role="cell">
              <RiskBadge level={review.highestRiskLevel} />
            </span>
            <span role="cell">{review.reviewer}</span>
            <span role="cell">{review.plannedPublishDate}</span>
            <span className="review-table__open" role="cell">
              <ChevronRight size={16} aria-hidden="true" />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
