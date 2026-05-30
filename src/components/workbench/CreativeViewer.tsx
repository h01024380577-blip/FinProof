"use client";

import { useEffect, useRef, useState, type CSSProperties, type JSX } from "react";
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
  const viewerRef = useRef<HTMLElement>(null);
  const [zoom, setZoom] = useState(100);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const zoomScale = zoom / 100;
  const zoomStageStyle = {
    "--viewer-zoom": `${zoomScale}`,
    "--viewer-zoom-height": `${POSTER_BASE_HEIGHT * zoomScale}px`
  } as CSSProperties;

  useEffect(() => {
    const syncFullscreenState = (): void => {
      setIsFullscreen(document.fullscreenElement === viewerRef.current);
    };

    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);

  const adjustZoom = (direction: "in" | "out"): void => {
    setZoom((currentZoom) => {
      const nextZoom =
        direction === "in" ? currentZoom + ZOOM_STEP : currentZoom - ZOOM_STEP;
      return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
    });
  };

  const toggleFullscreen = async (): Promise<void> => {
    const viewerElement = viewerRef.current;

    if (!viewerElement) {
      return;
    }

    if (isFullscreen || document.fullscreenElement === viewerElement) {
      try {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        }
      } catch {
        // Keep the CSS fallback in sync even if the browser rejects fullscreen exit.
      }
      setIsFullscreen(false);
      return;
    }

    try {
      if (viewerElement.requestFullscreen) {
        await viewerElement.requestFullscreen();
      }
    } catch {
      // Fall back to the fixed-position viewer for unsupported or rejected fullscreen requests.
    }
    setIsFullscreen(true);
  };

  return (
    <section
      ref={viewerRef}
      className="creative-viewer"
      aria-label="문서 미리보기"
      data-fullscreen={isFullscreen}
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
          aria-label={isFullscreen ? "전체 화면 종료" : "전체 화면"}
          onClick={toggleFullscreen}
        >
          {isFullscreen ? (
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
