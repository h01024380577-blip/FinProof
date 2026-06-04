import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationCenter } from "./NotificationCenter";

const roleMock = vi.hoisted(() => ({
  activeRole: "reviewer",
  apiHeaders: vi.fn((extra: Record<string, string> = {}) => ({
    authorization: "Bearer test-token",
    ...extra
  })),
  isAuthenticated: true,
  currentUser: {
    name: "준법심의자 박민준",
    role: "reviewer",
    userId: "user-reviewer"
  }
}));

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("./RoleContext", () => ({
  useRole: () => roleMock
}));

type ReviewSummaryFixture = {
  id: string;
  title: string;
  requester: string;
  status: "submitted" | "analysis_waiting" | "approved" | "rejected" | "under_review" | "draft";
};

function review(overrides: ReviewSummaryFixture): ReviewSummaryFixture {
  return overrides;
}

function mockReviewResponse(reviews: ReviewSummaryFixture[]) {
  fetchMock.mockImplementation(
    async () =>
      new Response(JSON.stringify(reviews), {
        headers: { "content-type": "application/json" },
        status: 200
      })
  );
}

function resetRole(overrides: Partial<typeof roleMock> = {}) {
  roleMock.activeRole = "reviewer";
  roleMock.isAuthenticated = true;
  roleMock.currentUser = {
    name: "준법심의자 박민준",
    role: "reviewer",
    userId: "user-reviewer"
  };
  roleMock.apiHeaders.mockClear();
  roleMock.apiHeaders.mockImplementation((extra: Record<string, string> = {}) => ({
    authorization: "Bearer test-token",
    ...extra
  }));

  Object.assign(roleMock, overrides);
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  resetRole();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("NotificationCenter", () => {
  it("fetches review cases with role API headers and lists new review requests for reviewers", async () => {
    mockReviewResponse([
      review({
        id: "rc-new-submitted",
        title: "대출 광고 신규 요청",
        requester: "마케팅 담당자 김지현",
        status: "submitted"
      }),
      review({
        id: "rc-new-analysis",
        title: "적금 홍보물 분석 대기",
        requester: "마케팅 담당자 최도윤",
        status: "analysis_waiting"
      }),
      review({
        id: "rc-approved",
        title: "이미 완료된 요청",
        requester: "마케팅 담당자 정하린",
        status: "approved"
      })
    ]);

    render(<NotificationCenter />);

    expect(await screen.findByText("2")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/review-cases", {
      headers: { authorization: "Bearer test-token" }
    });
    expect(roleMock.apiHeaders).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /알림/ }));

    const popover = screen.getByRole("dialog", { name: "알림 목록" });
    expect(within(popover).getAllByText("신규 심의 요청이 도착했습니다")).toHaveLength(2);
    expect(within(popover).getByText("대출 광고 신규 요청")).toBeInTheDocument();
    expect(within(popover).getByText("rc-new-submitted")).toBeInTheDocument();
    expect(within(popover).queryByText("이미 완료된 요청")).not.toBeInTheDocument();
  });

  it("uses the same new-review notification rules for compliance admins", async () => {
    resetRole({
      activeRole: "compliance_admin",
      currentUser: {
        name: "관리자 이서연",
        role: "compliance_admin",
        userId: "user-admin"
      }
    });
    mockReviewResponse([
      review({
        id: "rc-admin-new",
        title: "관리자 확인 대상",
        requester: "마케팅 담당자 김지현",
        status: "submitted"
      })
    ]);

    render(<NotificationCenter />);

    expect(await screen.findByText("1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /알림/ }));

    expect(screen.getByText("신규 심의 요청이 도착했습니다")).toBeInTheDocument();
    expect(screen.getByText("관리자 확인 대상")).toBeInTheDocument();
  });

  it("lists completed own requests for requesters with approved and rejected results", async () => {
    resetRole({
      activeRole: "requester",
      currentUser: {
        name: "김지현",
        role: "requester",
        userId: "user-requester"
      }
    });
    mockReviewResponse([
      review({
        id: "rc-my-approved",
        title: "내 승인 요청",
        requester: "김지현",
        status: "approved"
      }),
      review({
        id: "rc-my-rejected",
        title: "내 반려 요청",
        requester: "마케팅 담당자 김지현",
        status: "rejected"
      }),
      review({
        id: "rc-other-approved",
        title: "다른 요청자의 승인",
        requester: "마케팅 담당자 최도윤",
        status: "approved"
      }),
      review({
        id: "rc-my-draft",
        title: "아직 진행 중인 내 요청",
        requester: "김지현",
        status: "draft"
      })
    ]);

    render(<NotificationCenter />);

    expect(await screen.findByText("2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /알림/ }));

    const popover = screen.getByRole("dialog", { name: "알림 목록" });
    expect(within(popover).getAllByText("요청한 건의 심의가 완료됐습니다")).toHaveLength(2);
    expect(within(popover).getByText("결과: 승인")).toBeInTheDocument();
    expect(within(popover).getByText("결과: 반려")).toBeInTheDocument();
    expect(within(popover).getByText("내 승인 요청")).toBeInTheDocument();
    expect(within(popover).getByText("내 반려 요청")).toBeInTheDocument();
    expect(within(popover).queryByText("다른 요청자의 승인")).not.toBeInTheDocument();
    expect(within(popover).queryByText("아직 진행 중인 내 요청")).not.toBeInTheDocument();
  });

  it("shows a concise empty state when there are no notifications", async () => {
    mockReviewResponse([
      review({
        id: "rc-under-review",
        title: "이미 심의 중인 요청",
        requester: "마케팅 담당자 김지현",
        status: "under_review"
      })
    ]);

    render(<NotificationCenter />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /알림/ }));

    expect(await screen.findByText("새 알림이 없습니다.")).toBeInTheDocument();
  });

  it("refreshes when opened, refreshes from the popover, and polls while authenticated", async () => {
    vi.useFakeTimers();
    mockReviewResponse([
      review({
        id: "rc-new-submitted",
        title: "대출 광고 신규 요청",
        requester: "마케팅 담당자 김지현",
        status: "submitted"
      })
    ]);

    render(<NotificationCenter />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /알림/ }));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "알림 새로고침" }));
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not fetch while unauthenticated", async () => {
    resetRole({
      isAuthenticated: false
    });
    mockReviewResponse([]);

    render(<NotificationCenter />);

    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /알림/ }));
    expect(screen.getByText("새 알림이 없습니다.")).toBeInTheDocument();
  });
});
