"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type JSX } from "react";
import { LoaderCircle, Maximize2, Minimize2, Minus, Plus } from "lucide-react";
import type { ReviewIssue } from "@/domain/types";

const MIN_ZOOM = 50;
const MAX_ZOOM = 200;
const ZOOM_STEP = 25;
const POSTER_BASE_HEIGHT = 642;
const POSTER_BASE_WIDTH = 480;

export type CreativeViewerProps = {
  copy: string;
  disclosure: string;
  creativeImage?: {
    src: string;
    alt: string;
  };
  isCreativeImageLoading?: boolean;
  issues: ReviewIssue[];
  selectedIssueId?: string;
  onSelectIssue: (issueId: string) => void;
};

function HighlightBoxes({
  issues,
  selectedIssueId,
  onSelectIssue
}: Pick<CreativeViewerProps, "issues" | "selectedIssueId" | "onSelectIssue">): JSX.Element {
  const selectedIssueIndex = issues.findIndex((issue) => issue.id === selectedIssueId);
  const selectedIssue = selectedIssueIndex >= 0 ? issues[selectedIssueIndex] : undefined;

  if (!selectedIssue) {
    return <></>;
  }

  const [left, top, width, height] = selectedIssue.targetBbox;

  return (
    <button
      className="highlight-box"
      data-risk={selectedIssue.riskLevel}
      data-active="true"
      style={{
        left: `${left}%`,
        top: `${top}%`,
        width: `${width}%`,
        height: `${height}%`
      }}
      type="button"
      title={selectedIssue.title}
      onClick={() => onSelectIssue(selectedIssue.id)}
    >
      <span>{selectedIssueIndex + 1}</span>
    </button>
  );
}

export function CreativeViewer({
  copy,
  disclosure,
  creativeImage,
  isCreativeImageLoading = false,
  issues,
  selectedIssueId,
  onSelectIssue
}: CreativeViewerProps): JSX.Element {
  const [zoom, setZoom] = useState(100);
  const [isFrameFit, setIsFrameFit] = useState(false);
  const [fitZoom, setFitZoom] = useState(100);
  const viewportRef = useRef<HTMLDivElement>(null);

  const calcFitZoom = useCallback((): number => {
    const el = viewportRef.current;
    if (!el) return 100;
    const availH = el.clientHeight - 32;
    const availW = el.clientWidth - 32;
    const scale = Math.min(availH / POSTER_BASE_HEIGHT, availW / POSTER_BASE_WIDTH);
    return Math.round(Math.min(1, scale) * 100);
  }, []);

  useEffect(() => {
    if (!isFrameFit) return;
    const el = viewportRef.current;
    if (!el) return;
    if (typeof ResizeObserver === "undefined") {
      const timeoutId = window.setTimeout(() => setFitZoom(calcFitZoom()), 0);
      return () => window.clearTimeout(timeoutId);
    }
    const ro = new ResizeObserver(() => setFitZoom(calcFitZoom()));
    ro.observe(el);
    return () => ro.disconnect();
  }, [isFrameFit, calcFitZoom]);

  const activeZoom = isFrameFit ? fitZoom : zoom;
  const zoomStageStyle = {
    "--viewer-zoom": `${activeZoom / 100}`
  } as CSSProperties;

  const adjustZoom = (direction: "in" | "out"): void => {
    setIsFrameFit(false);
    setZoom((currentZoom) => {
      const nextZoom =
        direction === "in" ? currentZoom + ZOOM_STEP : currentZoom - ZOOM_STEP;
      return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
    });
  };

  const toggleFrameFit = (): void => {
    setIsFrameFit((v) => !v);
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
          disabled={isFrameFit || zoom <= MIN_ZOOM}
          onClick={() => adjustZoom("out")}
        >
          <Minus size={15} aria-hidden="true" />
        </button>
        <span>{isFrameFit ? "맞춤" : `${zoom}%`}</span>
        <button
          className="icon-button icon-button--small"
          type="button"
          aria-label="확대"
          disabled={isFrameFit || zoom >= MAX_ZOOM}
          onClick={() => adjustZoom("in")}
        >
          <Plus size={15} aria-hidden="true" />
        </button>
        <span>1 / 1</span>
        <button
          className="icon-button icon-button--small"
          type="button"
          aria-label={isFrameFit ? "페이지 맞추기 해제" : "페이지 맞추기"}
          onClick={toggleFrameFit}
        >
          {isFrameFit ? (
            <Minimize2 size={15} aria-hidden="true" />
          ) : (
            <Maximize2 size={15} aria-hidden="true" />
          )}
        </button>
      </div>
      <div className="viewer-viewport" ref={viewportRef}>
        <div
          className="poster-zoom-stage"
          data-testid="creative-viewer-zoom-stage"
          data-frame-fit={isFrameFit}
          style={zoomStageStyle}
        >
          {isCreativeImageLoading ? (
            <div
              className="poster poster--loading"
              role="status"
              aria-label="홍보 포스터 로딩"
            >
              <LoaderCircle className="action-spinner" size={28} aria-hidden="true" />
              <span>홍보 포스터를 불러오는 중입니다.</span>
            </div>
          ) : creativeImage ? (
            <div className="poster poster--uploaded" data-source="uploaded">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="poster__image"
                src={creativeImage.src}
                alt={`${creativeImage.alt} 실제 심의자료 포스터`}
                draggable={false}
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
