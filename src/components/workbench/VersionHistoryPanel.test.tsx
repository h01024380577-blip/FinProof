import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReviewVersion } from "@/domain/types";
import { VersionHistoryPanel } from "./VersionHistoryPanel";

const version: ReviewVersion = {
  id: "rv-1",
  reviewCaseId: "rc-1",
  versionNumber: 1,
  status: "change_requested",
  reviewerComment: "최고금리 조건 병기 필요",
  opinionDraft: "조건부 혜택임을 명확히 표시해 주세요.",
  issuesSnapshot: [
    {
      id: "issue-1",
      issueType: "claim",
      riskLevel: "high",
      title: "최고 연 5.0% 조건 표시 부족",
      targetText: "최고 연 5.0% 적금!",
      targetBbox: [0, 0, 0, 0],
      sourceAgents: ["manual"],
      suggestedAction: "change_request",
      status: "open",
      description: "설명",
      suggestedCopy: "수정 문구",
      evidence: []
    }
  ],
  filesSnapshot: [{ id: "file-1", name: "deposit-poster.png", fileType: "promotional_creative" }],
  decidedByUserId: "user-reviewer-demo",
  decidedByName: "박심의",
  decidedAt: "2026-06-20T01:00:00.000Z",
  createdAt: "2026-06-20T01:00:00.000Z"
};

describe("VersionHistoryPanel", () => {
  it("renders a read-only snapshot of a past review version", () => {
    render(<VersionHistoryPanel version={version} />);

    expect(screen.getByText("1회차 심의 결과")).toBeInTheDocument();
    expect(screen.getByText("수정 요청")).toBeInTheDocument();
    expect(screen.getByText("박심의")).toBeInTheDocument();
    expect(screen.getByText("최고금리 조건 병기 필요")).toBeInTheDocument();
    expect(screen.getByText("조건부 혜택임을 명확히 표시해 주세요.")).toBeInTheDocument();
    expect(screen.getByText("이슈 스냅샷 (1)")).toBeInTheDocument();
    expect(screen.getByText("최고 연 5.0% 조건 표시 부족")).toBeInTheDocument();
    expect(screen.getByText("deposit-poster.png")).toBeInTheDocument();
  });
});
