import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { RequesterRequestCenter, RequesterRequestHistory } from "./RequesterRequestCenter";
import { RevisionUploadPanel } from "./RevisionUploadPanel";

const navigationMock = vi.hoisted(() => ({
  push: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: navigationMock.push,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn()
  })
}));

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
    highestRiskLevel: "high",
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

    const historyGrid = screen.getByRole("grid", { name: "요청 기록 목록" });
    expect(
      within(historyGrid)
        .getAllByRole("columnheader")
        .map((header) => header.textContent)
    ).toEqual(["요청번호", "제목", "제휴사", "상품유형", "예정 게시일", "상태", "담당자", "작업"]);

    const rejectedRow = screen.getByRole("row", { name: "김서연 대출 배너" });
    expect(
      within(rejectedRow)
        .getAllByRole("cell")
        .map((cell) => cell.textContent)
    ).toEqual([
      "rc-own-rejected-001",
      "김서연 대출 배너",
      "하나은행",
      "대출",
      "2026-06-12",
      "반려",
      "준법심의자 박민준",
      "반려사유재검토 요청"
    ]);
    expect(within(rejectedRow).getByText("반려")).toBeInTheDocument();

    const toggleButton = within(rejectedRow).getByRole("button", {
      name: "반려사유 펼치기"
    });
    expect(toggleButton).toHaveTextContent("반려사유");
    await user.click(toggleButton);

    const rejectionNote = screen.getByRole("cell", { name: "반려사유" });
    expect(within(rejectionNote).getByText("반려사유")).toBeInTheDocument();
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
    const waitingStatus = within(waitingRow).getByText("검토중");
    expect(waitingStatus).toBeInTheDocument();
    expect(waitingStatus).toHaveClass("request-history-status");
    expect(waitingStatus).not.toHaveClass("status-badge");
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

    expect(
      await screen.findByRole("row", { name: "이전 담당자가 올린 카드 배너" })
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/review-cases",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-finproof-user-id": "user-requester-kmu-marketing"
        })
      })
    );
  });

  it("posts a revised package and shows a success notice (re-upload happy path)", async () => {
    const user = userEvent.setup();
    const apiHeaders = vi.fn(() => ({
      "x-finproof-role": "requester",
      authorization: "Bearer requester.jwt"
    }));
    const onSuccess = vi.fn();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({
        reviewCase: { id: "rc-own-rejected-001" },
        analysisStartHref: "/api/v1/review-cases/rc-own-rejected-001/analysis/start"
      })
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <RevisionUploadPanel
        caseId="rc-own-rejected-001"
        apiHeaders={apiHeaders}
        onSuccess={onSuccess}
      />
    );

    const fileInput = screen.getByLabelText("심의 대상 패키지를 업로드하세요 (ZIP, PDF, JPG)");
    const file = new File(["revised"], "revision.pdf", { type: "application/pdf" });
    await user.upload(fileInput, file);

    await user.click(screen.getByRole("button", { name: "재업로드" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/review-cases/rc-own-rejected-001/revisions",
        expect.objectContaining({
          method: "POST",
          body: expect.any(FormData),
          headers: expect.objectContaining({ "x-finproof-role": "requester" })
        })
      );
    });

    const formData = fetchMock.mock.calls[0][1].body as FormData;
    expect(formData.getAll("files")).toHaveLength(1);
    expect(await screen.findByText("재검토 요청이 접수되었습니다.")).toBeInTheDocument();
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("renders the certificate when an approved case is expanded (심의필 happy path)", async () => {
    const user = userEvent.setup();
    setRole();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === "/api/v1/review-cases") {
        return {
          ok: true,
          json: async () => ({
            items: [
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
              }
            ]
          })
        };
      }

      if (url === "/api/v1/review-cases/rc-own-approved-001/certificate") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            certificate: {
              certificateNumber: "FP-2026-ABC123",
              body: "본 광고물은 관련 규정을 준수합니다.",
              metadata: {
                title: "김서연 예금 앱푸시",
                productType: "deposit",
                affiliateName: "하나은행",
                reviewerName: "준법심의자 박민준",
                approvedAt: "2026-06-20T05:00:00.000Z"
              },
              issuedByName: "준법심의자 박민준",
              issuedAt: "2026-06-13T05:01:00.000Z"
            }
          })
        };
      }

      return { ok: false, status: 404, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<RequesterRequestHistory />);

    const approvedRow = await screen.findByRole("row", { name: "김서연 예금 앱푸시" });
    await user.click(within(approvedRow).getByRole("button", { name: "심의필 보기" }));

    expect(await screen.findByText("심의필번호 FP-2026-ABC123")).toBeInTheDocument();
    expect(screen.getByText("본 광고물은 관련 규정을 준수합니다.")).toBeInTheDocument();
    expect(screen.getByText("2026-06-20")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/review-cases/rc-own-approved-001/certificate",
      expect.objectContaining({
        headers: expect.objectContaining({ "x-finproof-role": "requester" })
      })
    );
  });
});
