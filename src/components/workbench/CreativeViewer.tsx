"use client";

import { useState, type CSSProperties, type JSX } from "react";
import Image from "next/image";
import { Maximize2, Minimize2, Minus, Plus } from "lucide-react";
import type { ReviewIssue } from "@/domain/types";

const MIN_ZOOM = 50;
const MAX_ZOOM = 200;
const ZOOM_STEP = 25;
const POSTER_BASE_HEIGHT = 642;

export type CreativeViewerProps = {
  copy: string;
  disclosure: string;
  creativeImage?: {
    src: string;
    alt: string;
  };
  issues: ReviewIssue[];
  selectedIssueId?: string;
  onSelectIssue: (issueId: string) => void;
};

function HighlightBoxes({
  issues,
  selectedIssueId,
  onSelectIssue
}: Pick<CreativeViewerProps, "issues" | "selectedIssueId" | "onSelectIssue">): JSX.Element {
  return (
    <>
      {issues.map((issue, index) => {
        const [left, top, width, height] = issue.targetBbox;
        return (
          <button
            key={issue.id}
            className="highlight-box"
            data-risk={issue.riskLevel}
            data-active={selectedIssueId === issue.id}
            style={{
              left: `${left}%`,
              top: `${top}%`,
              width: `${width}%`,
              height: `${height}%`
            }}
            type="button"
            title={issue.title}
            onClick={() => onSelectIssue(issue.id)}
          >
            <span>{index + 1}</span>
          </button>
        );
      })}
    </>
  );
}

export function CreativeViewer({
  copy,
  disclosure,
  creativeImage,
  issues,
  selectedIssueId,
  onSelectIssue
}: CreativeViewerProps): JSX.Element {
  const [zoom, setZoom] = useState(100);
  const [isFrameFit, setIsFrameFit] = useState(false);
  const zoomScale = zoom / 100;
  const zoomStageStyle = {
    "--viewer-zoom": `${isFrameFit ? 1 : zoomScale}`,
    "--viewer-zoom-height": isFrameFit ? "100%" : `${POSTER_BASE_HEIGHT * zoomScale}px`
  } as CSSProperties;

  const adjustZoom = (direction: "in" | "out"): void => {
    setZoom((currentZoom) => {
      const nextZoom =
        direction === "in" ? currentZoom + ZOOM_STEP : currentZoom - ZOOM_STEP;
      return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
    });
  };

  const toggleFrameFit = (): void => {
    setIsFrameFit((currentValue) => !currentValue);
  };

  return (
    <section
      className="creative-viewer"
      aria-label="문서 미리보기"
      data-frame-fit={isFrameFit}
    >
      <div className="viewer-toolbar" aria-label="문서 보기 도구">
        <button
          className="icon-button icon-button--small"
          type="button"
          aria-label="축소"
          disabled={zoom <= MIN_ZOOM}
          onClick={() => adjustZoom("out")}
        >
          <Minus size={15} aria-hidden="true" />
        </button>
        <span>{zoom}%</span>
        <button
          className="icon-button icon-button--small"
          type="button"
          aria-label="확대"
          disabled={zoom >= MAX_ZOOM}
          onClick={() => adjustZoom("in")}
        >
          <Plus size={15} aria-hidden="true" />
        </button>
        <span>1 / 1</span>
        <button
          className="icon-button icon-button--small"
          type="button"
          aria-label={isFrameFit ? "전체 화면 종료" : "전체 화면"}
          onClick={toggleFrameFit}
        >
          {isFrameFit ? (
            <Minimize2 size={15} aria-hidden="true" />
          ) : (
            <Maximize2 size={15} aria-hidden="true" />
          )}
        </button>
      </div>
      <div className="viewer-viewport">
        <div
          className="poster-zoom-stage"
          data-testid="creative-viewer-zoom-stage"
          data-frame-fit={isFrameFit}
          style={zoomStageStyle}
        >
          {creativeImage ? (
            <div className="poster poster--uploaded" data-source="uploaded">
              <Image
                className="poster__image"
                src={creativeImage.src}
                alt={`${creativeImage.alt} 실제 심의자료 포스터`}
                fill
                sizes="(max-width: 1200px) 100vw, 48vw"
                unoptimized
              />
              <HighlightBoxes
                issues={issues}
                selectedIssueId={selectedIssueId}
                onSelectIssue={onSelectIssue}
              />
            </div>
          ) : (
            <div className="poster">
              <strong className="poster__brand">FinProof Bank</strong>
              <div className="poster__copy">{copy}</div>
              <p>{disclosure}</p>
              <HighlightBoxes
                issues={issues}
                selectedIssueId={selectedIssueId}
                onSelectIssue={onSelectIssue}
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
