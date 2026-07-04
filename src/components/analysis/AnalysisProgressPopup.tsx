"use client";

import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, CircleDot, X, AlertCircle } from "lucide-react";
import { useRole } from "@/components/RoleContext";
import type { AnalysisEventRecord } from "@/server/reviews/review-store";
import { buildProgressLines } from "./analysis-progress-copy";

type EventsResponse = {
  jobId: string | null;
  status: "queued" | "running" | "completed" | "failed" | null;
  events: AnalysisEventRecord[];
};

const POLL_MS = 1500;

/**
 * Reviewer-facing live timeline of an analysis run. Mount it only while open
 * (e.g. `{caseId ? <AnalysisProgressPopup key={caseId} ... /> : null}`) so each
 * open starts with fresh state — the component intentionally has no reset logic.
 */
export function AnalysisProgressPopup({
  reviewCaseId,
  onClose
}: {
  reviewCaseId: string;
  onClose: () => void;
}) {
  const { apiHeaders } = useRole();
  const [events, setEvents] = useState<AnalysisEventRecord[]>([]);
  const [status, setStatus] = useState<EventsResponse["status"]>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let jobId: string | null = null;
    let cursor: number | null = null;

    const schedule = () => {
      timer = setTimeout(() => void tick(), POLL_MS);
    };

    const tick = async () => {
      const url =
        `/api/v1/review-cases/${reviewCaseId}/analysis/events` +
        (cursor !== null ? `?since=${cursor}` : "");
      try {
        const res = await fetch(url, { headers: apiHeaders() });
        if (cancelled) return;
        if (!res.ok) {
          schedule();
          return;
        }
        const body = (await res.json()) as EventsResponse;
        if (cancelled) return;

        if (body.jobId !== jobId) {
          // A different (usually newer) job — restart the timeline from scratch.
          const hadProgress = cursor !== null;
          jobId = body.jobId;
          cursor = null;
          if (hadProgress) {
            setEvents([]);
            setStatus(body.status);
            schedule();
            return;
          }
          setEvents(body.events);
        } else if (body.events.length > 0) {
          setEvents((prev) => [...prev, ...body.events]);
        }

        const last = body.events[body.events.length - 1];
        if (last) {
          cursor = last.seq;
        }
        setStatus(body.status);
        if (body.status === "queued" || body.status === "running") {
          schedule();
        }
      } catch {
        if (!cancelled) {
          schedule();
        }
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [reviewCaseId, apiHeaders]);

  const lines = buildProgressLines(events);

  return (
    <section
      className="analysis-progress"
      role="dialog"
      aria-modal="false"
      aria-label="AI 분석 진행상황"
    >
      <header className="analysis-progress__header">
        <span className="analysis-progress__title">AI 분석 진행상황</span>
        <button
          type="button"
          className="analysis-progress__close"
          onClick={onClose}
          aria-label="닫기"
        >
          <X size={16} />
        </button>
      </header>
      <ol className="analysis-progress__list">
        {lines.map((line) => (
          <li key={line.id} className="analysis-progress__item" data-state={line.state}>
            <span className="analysis-progress__icon">
              {line.state === "running" ? (
                <Loader2 className="analysis-progress__spin" size={16} />
              ) : line.state === "done" ? (
                <CheckCircle2 size={16} />
              ) : line.state === "error" ? (
                <AlertCircle size={16} />
              ) : (
                <CircleDot size={16} />
              )}
            </span>
            <span className="analysis-progress__text">
              {line.text}
              {line.evidence && line.evidence.length > 0 ? (
                <span className="analysis-progress__chips">
                  {line.evidence.map((chip, index) => (
                    <span key={index} className="analysis-progress__chip">
                      {chip}
                    </span>
                  ))}
                </span>
              ) : null}
            </span>
          </li>
        ))}
        {lines.length === 0 ? (
          <li className="analysis-progress__item" data-state="info">
            <span className="analysis-progress__text">분석 대기 중이에요…</span>
          </li>
        ) : null}
        {status === "failed" ? (
          <li className="analysis-progress__item" data-state="error">
            <span className="analysis-progress__text">분석이 중단되었어요</span>
          </li>
        ) : null}
      </ol>
    </section>
  );
}
