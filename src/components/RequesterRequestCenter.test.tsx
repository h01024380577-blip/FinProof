import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { RequesterRequestCenter, RequesterRequestHistory } from "./RequesterRequestCenter";

type MockRoleId = "requester" | "reviewer" | "compliance_admin";
type MockRoleValue = {
  activeRole: MockRoleId;
  isAuthenticated: boolean;
  currentUser?: {
    name: string;
    role: MockRoleId;
    userId: string;
  };
  apiHeaders: (extra?: Record<string, string>) => Record<string, string>;
};

const roleMock = vi.hoisted(() => ({
  current: {} as MockRoleValue
}));

vi.mock("./RoleContext", () => ({
  useRole: () => roleMock.current,
  useRoleContext: () => roleMock.current
}));

function setRole(overrides: Partial<MockRoleValue> = {}) {
  const activeRole = overrides.activeRole ?? "requester";
  const apiHeaders = vi.fn((extra: Record<string, string> = {}) => ({
    "x-finproof-role": activeRole,
    "x-finproof-user-id": roleMock.current.currentUser?.userId ?? "requester-kim",
    authorization: "Bearer requester.jwt",
    ...extra
  }));

  roleMock.current = {
    activeRole,
    isAuthenticated: true,
    currentUser: {
      name: "김서연",
      role: "requester",
      userId: "requester-kim"
    },
    apiHeaders,
    ...overrides
  };

  return apiHeaders;
}

const requesterHistoryRows = [
  {
    id: "rc-own-rejected-001",
    title: "김서연 대출 배너",
    affiliate: "하나은행",
    productType: "loan",
    plannedPublishDate: "2026-06-12",
    status: "rejected",
    highestRiskLevel: "reject_recommended",
    requester: "마케팅1팀 김서연",
    reviewer: "준법심의자 박민준"
  },
  {
    id: "rc-own-approved-001",
    title: "김서연 예금 앱푸시",
    affiliate: "하나은행",
    productType: "deposit",
    plannedPublishDate: "2026-06-13",
    status: "approved",
    highestRiskLevel: "info",
    requester: "김서연",
    reviewer: "준법심의자 박민준"
  },
  {
    id: "rc-own-waiting-001",
    title: "김서연 카드 상세페이지",
    affiliate: "하나카드",
    productType: "card",
    plannedPublishDate: "2026-06-14",
    status: "under_review",
    highestRiskLevel: "caution",
    requester: "디지털마케팅실 김서연",
    reviewer: "준법심의자 박민준"
  },
  {
    id: "rc-other-approved-001",
    title: "이민수 예금 배너",
    affiliate: "하나은행",
    productType: "deposit",
    plannedPublishDate: "2026-06-15",
    status: "approved",
    highestRiskLevel: "info",
    requester: "이민수",
    reviewer: "준법심의자 박민준"
  }
];

const reviewDetailsById = {
  "rc-own-rejected-001": {
    ...requesterHistoryRows[0],
    currentDraft: "비교 조건과 상환 예시 문구를 구체적으로 보완해 주세요.",
    currentDraftVersion: 3
  },
  "rc-own-approved-001": {
    ...requesterHistoryRows[1],
    currentDraft: "승인 건에 저장된 수정 요청 초안은 요청자 화면에서 숨겨야 합니다.",
    currentDraftVersion: 2
  },
  "rc-own-waiting-001": {
    ...requesterHistoryRows[2],
    currentDraft: "검토 중 초안도 최종 반려 전에는 숨겨야 합니다.",
    currentDraftVersion: 1
  }
};

function mockHistoryFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url === "/api/v1/review-cases") {
      return {
        ok: true,
        json: async () => ({ items: requesterHistoryRows.slice(0, 3) })
      };
    }

    const reviewId = url.replace("/api/v1/review-cases/", "");
    const reviewCase = reviewDetailsById[reviewId as keyof typeof reviewDetailsById];

    if (reviewCase) {
      return {
        ok: true,
        json: async () => ({ reviewCase })
      };
    }

    return {
      ok: false,
      json: async () => ({})
    };
  });
}

describe("RequesterRequestCenter", () => {
  beforeEach(() => {
    setRole();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows a login-required empty state when the user is not authenticated as a requester", () => {
    setRole({
      activeRole: "reviewer",
      isAuthenticated: false,
      currentUser: {
        name: "박민준",
        role: "reviewer",
        userId: "reviewer-park"
      }
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<RequesterRequestCenter />);

    expect(screen.getByText("요청자 계정으로 로그인해 주세요.")).toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "요청자 심의 요청" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not fetch request history when the user is not authenticated as a requester", () => {
    setRole({
      activeRole: "reviewer",
      isAuthenticated: true,
      currentUser: {
        name: "박민준",
        role: "reviewer",
        userId: "reviewer-park"
      }
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<RequesterRequestHistory />);

    expect(screen.getByText("요청자 계정으로 로그인해 주세요.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders only the new request intake screen without nested history tabs", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<RequesterRequestCenter />);

    expect(screen.queryByRole("tablist", { name: "요청자 심의 요청" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "요청 기록" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "신규 심의 요청" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads only the logged-in requester's history and hides saved drafts except rejected results", async () => {
    const user = userEvent.setup();
    const apiHeaders = setRole();
    const fetchMock = mockHistoryFetch();
    vi.stubGlobal("fetch", fetchMock);

    render(<RequesterRequestHistory />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/review-cases",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-finproof-role": "requester",
          authorization: "Bearer requester.jwt"
        })
      })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/review-cases/rc-own-rejected-001",
      expect.any(Object)
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/review-cases/rc-own-approved-001",
      expect.any(Object)
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/review-cases/rc-own-waiting-001",
      expect.any(Object)
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/review-cases/rc-other-approved-001",
      expect.any(Object)
    );
    expect(apiHeaders).toHaveBeenCalledTimes(2);

    const rejectedRow = screen.getByRole("row", { name: "김서연 대출 배너" });
    expect(within(rejectedRow).getByText("반려")).toBeInTheDocument();

    const toggleButton = within(rejectedRow).getByRole("button", {
      name: "반려사유 펼치기"
    });
    expect(toggleButton).toHaveTextContent("반려사유");
    await user.click(toggleButton);

    expect(screen.getByText("수정 요청")).toBeInTheDocument();
    expect(
      screen.getByText("비교 조건과 상환 예시 문구를 구체적으로 보완해 주세요.")
    ).toBeInTheDocument();
    expect(screen.queryByText("버전 3")).not.toBeInTheDocument();
    expect(toggleButton).toHaveAccessibleName("반려사유 접기");

    const approvedRow = screen.getByRole("row", { name: "김서연 예금 앱푸시" });
    expect(within(approvedRow).getByText("승인")).toBeInTheDocument();
    expect(
      screen.queryByText("승인 건에 저장된 수정 요청 초안은 요청자 화면에서 숨겨야 합니다.")
    ).not.toBeInTheDocument();

    const waitingRow = screen.getByRole("row", { name: "김서연 카드 상세페이지" });
    expect(within(waitingRow).getByText("검토중")).toBeInTheDocument();
    expect(
      screen.queryByText("검토 중 초안도 최종 반려 전에는 숨겨야 합니다.")
    ).not.toBeInTheDocument();

    expect(screen.queryByText("이민수 예금 배너")).not.toBeInTheDocument();
  });

  it("keeps requester history visible when the display name differs from the stored requester name", async () => {
    setRole({
      currentUser: {
        name: "새 담당자",
        role: "requester",
        userId: "user-requester-kmu-marketing"
      }
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/v1/review-cases") {
        return {
          ok: true,
          json: async () => ({
            items: [
              {
                id: "rc-code-owned-001",
                title: "이전 담당자가 올린 카드 배너",
                affiliate: "하나카드",
                productType: "card",
                plannedPublishDate: "2026-06-14",
                status: "under_review",
                highestRiskLevel: "caution",
                requester: "퇴사자 김서연",
                reviewer: "준법심의자 박민준"
              }
            ]
          })
        };
      }

      return {
        ok: false,
        json: async () => ({})
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<RequesterRequestHistory />);

    expect(await screen.findByRole("row", { name: "이전 담당자가 올린 카드 배너" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/review-cases",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-finproof-user-id": "user-requester-kmu-marketing"
        })
      })
    );
  });
});
