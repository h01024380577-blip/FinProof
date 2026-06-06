import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import JSZip from "jszip";
import { SamplePackageSelector } from "./SamplePackageSelector";

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

function depositRequiredFiles(): File[] {
  return [
    new File(["poster"], "real-deposit-poster.png", { type: "image/png" }),
    new File(["copy"], "deposit-copy.txt", { type: "text/plain" }),
    new File(["desc"], "deposit-description.txt", { type: "text/plain" }),
    new File(["rate"], "deposit-rate.csv", { type: "text/csv" }),
    new File(["checklist"], "deposit-checklist.txt", { type: "text/plain" })
  ];
}

async function zipUploadFile(entries: Record<string, string>): Promise<File> {
  const zip = new JSZip();

  for (const [name, content] of Object.entries(entries)) {
    zip.file(name, content);
  }

  return new File([await zip.generateAsync({ type: "arraybuffer" })], "review-package.zip", {
    type: "application/zip"
  });
}

describe("SamplePackageSelector", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    navigationMock.push.mockClear();
    vi.useRealTimers();
  });

  it("shows the reference metadata form, stepper, upload zone, and side checks", () => {
    render(<SamplePackageSelector />);

    expect(screen.getByRole("heading", { name: "신규 심의 요청" })).toBeInTheDocument();
    expect(screen.getByText("요청 메타")).toBeInTheDocument();
    expect(screen.getByText("자료 업로드")).toBeInTheDocument();
    expect(screen.getByText("자동 분류 확인")).toBeInTheDocument();
    expect(screen.getByText("제출 완료")).toBeInTheDocument();
    expect(screen.getByLabelText("심의 요청 제목")).toBeInTheDocument();
    expect(screen.getByLabelText("계열사")).toBeInTheDocument();
    expect(screen.getByLabelText("요청 부서")).toBeInTheDocument();
    expect(screen.getByLabelText("상품군")).toBeInTheDocument();
    expect(screen.getByLabelText("게시 예정일")).toBeInTheDocument();
    expect(screen.getByText("심의 대상 패키지를 업로드하세요 (ZIP, PDF, JPG)")).toBeInTheDocument();
    expect(screen.getByText("자동 분류 확인 (업로드 된 파일)")).toBeInTheDocument();
    expect(screen.getByText("누락된 필수 자료")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "심의 요청 제출" })).toBeInTheDocument();
  });

  it("starts the new review request form empty and uses examples only as placeholders", () => {
    render(<SamplePackageSelector />);

    expect(screen.getByLabelText("심의 요청 제목")).toHaveValue("");
    expect(screen.getByPlaceholderText("예: 광주은행 모바일 앱 신규 예금 상품 홍보물 심의")).toBe(
      screen.getByLabelText("심의 요청 제목")
    );
    expect(screen.getByLabelText("계열사")).toHaveValue("");
    expect(screen.getByPlaceholderText("예: 하나은행")).toBe(screen.getByLabelText("계열사"));
    expect(screen.getByLabelText("요청 부서")).toHaveValue("");
    expect(screen.getByPlaceholderText("예: 디지털마케팅팀")).toBe(
      screen.getByLabelText("요청 부서")
    );
    expect(screen.getByLabelText("상품군")).toHaveValue("");
    expect(screen.getByRole("option", { name: "상품군을 선택하세요" })).toBeInTheDocument();
    expect(screen.getByLabelText("게시 예정일")).toHaveValue("");
    expect(screen.getByLabelText("모바일 앱")).not.toBeChecked();
    expect(screen.getByLabelText("웹사이트")).not.toBeChecked();
    expect(screen.getByLabelText("오프라인")).not.toBeChecked();
    expect(screen.getByLabelText("요청 메모")).toHaveValue("");
    expect(
      screen.getByPlaceholderText("예: 금리 조건 표시와 유의사항 문구를 중점 검토해 주세요.")
    ).toBe(screen.getByLabelText("요청 메모"));
  });

  it("allows image-only submission for the image test product type", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        reviewCase: {
          id: "rc-upload-image-test-001",
          title: "이미지 테스트 심의",
          productType: "image_test"
        },
        files: [
          {
            id: "file-upload-image-test-001",
            name: "poster-only.png",
            fileType: "promotional_creative",
            classificationConfidence: 0.98,
            parseStatus: "pending"
          }
        ],
        missingMaterials: [],
        analysisStartHref: "/api/v1/review-cases/rc-upload-image-test-001/analysis/start"
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SamplePackageSelector />);

    expect(screen.getByRole("option", { name: "이미지 테스트" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("심의 요청 제목"), "이미지 테스트 심의");
    await user.type(screen.getByLabelText("계열사"), "광주은행");
    await user.type(screen.getByLabelText("요청 부서"), "디지털마케팅팀");
    await user.selectOptions(screen.getByLabelText("상품군"), "image_test");
    await user.type(screen.getByLabelText("게시 예정일"), "2026-06-20");
    await user.upload(
      screen.getByLabelText("심의 대상 패키지를 업로드하세요 (ZIP, PDF, JPG)", {
        selector: "input"
      }),
      new File(["poster"], "poster-only.png", { type: "image/png" })
    );

    expect(screen.getByRole("button", { name: "심의 요청 제출" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "심의 요청 제출" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/review-cases",
      expect.objectContaining({
        method: "POST",
        body: expect.any(FormData)
      })
    );
  });

  it("uploads real files, shows deterministic classification, and keeps analysis gated to queue", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        reviewCase: {
          id: "rc-upload-001",
          title: "실제 업로드 적금 홍보물",
          productType: "deposit"
        },
        files: [
          {
            id: "file-upload-001",
            name: "real-deposit-poster.png",
            fileType: "promotional_creative",
            classificationConfidence: 0.78,
            parseStatus: "pending"
          }
        ],
        missingMaterials: ["internal_checklist"],
        analysisStartHref: "/api/v1/review-cases/rc-upload-001/analysis/start"
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SamplePackageSelector />);

    await user.type(screen.getByLabelText("심의 요청 제목"), "실제 업로드 적금 홍보물");
    await user.type(screen.getByLabelText("계열사"), "광주은행");
    await user.type(screen.getByLabelText("요청 부서"), "디지털마케팅팀");
    await user.selectOptions(screen.getByLabelText("상품군"), "deposit");
    await user.type(screen.getByLabelText("게시 예정일"), "2026-06-20");
    await user.click(screen.getByLabelText("모바일 앱"));
    await user.type(screen.getByLabelText("요청 메모"), "금리 조건 표시를 검토해 주세요.");
    await user.upload(
      screen.getByLabelText("심의 대상 패키지를 업로드하세요 (ZIP, PDF, JPG)", {
        selector: "input"
      }),
      depositRequiredFiles()
    );
    await user.click(screen.getByRole("button", { name: "심의 요청 제출" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/review-cases",
      expect.objectContaining({
        method: "POST",
        body: expect.any(FormData)
      })
    );
    expect(screen.getAllByText("real-deposit-poster.png").length).toBeGreaterThan(0);
    expect(screen.getAllByText("홍보물 시안").length).toBeGreaterThan(0);
    expect(screen.getAllByText("내부 체크리스트").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /분석 시작/ })).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "심의 요청 등록 완료" })).toHaveTextContent(
      "심의 요청이 등록되었습니다."
    );
    await waitFor(() => expect(navigationMock.push).toHaveBeenCalledWith("/reviews/history"));
    expect(screen.queryByRole("link", { name: "심의 대기 목록에서 확인" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다른 요청 작성" })).not.toBeInTheDocument();
  });

  it("shows a spinner while submitting a new review request", async () => {
    const user = userEvent.setup();
    const uploadRequest = new Promise(() => undefined);
    const fetchMock = vi.fn().mockReturnValueOnce(uploadRequest);
    vi.stubGlobal("fetch", fetchMock);

    render(<SamplePackageSelector />);

    await user.type(screen.getByLabelText("심의 요청 제목"), "실제 업로드 적금 홍보물");
    await user.type(screen.getByLabelText("계열사"), "광주은행");
    await user.type(screen.getByLabelText("요청 부서"), "디지털마케팅팀");
    await user.selectOptions(screen.getByLabelText("상품군"), "deposit");
    await user.type(screen.getByLabelText("게시 예정일"), "2026-06-20");
    await user.upload(
      screen.getByLabelText("심의 대상 패키지를 업로드하세요 (ZIP, PDF, JPG)", {
        selector: "input"
      }),
      depositRequiredFiles()
    );
    await user.click(screen.getByRole("button", { name: "심의 요청 제출" }));

    const pendingButton = await screen.findByRole("button", { name: "제출 중" });
    expect(pendingButton).toBeDisabled();
    expect(pendingButton.querySelector(".action-spinner")).toBeInTheDocument();
  });

  it("places the completion notice above metadata and hides it automatically", async () => {
    const user = userEvent.setup();
    let hideNotice: (() => void) | undefined;
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        reviewCase: {
          id: "rc-upload-001",
          title: "실제 업로드 적금 홍보물",
          productType: "deposit"
        },
        files: [],
        missingMaterials: [],
        analysisStartHref: "/api/v1/review-cases/rc-upload-001/analysis/start"
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SamplePackageSelector />);

    await user.type(screen.getByLabelText("심의 요청 제목"), "실제 업로드 적금 홍보물");
    await user.type(screen.getByLabelText("계열사"), "광주은행");
    await user.type(screen.getByLabelText("요청 부서"), "디지털마케팅팀");
    await user.selectOptions(screen.getByLabelText("상품군"), "deposit");
    await user.type(screen.getByLabelText("게시 예정일"), "2026-06-20");
    await user.upload(
      screen.getByLabelText("심의 대상 패키지를 업로드하세요 (ZIP, PDF, JPG)", {
        selector: "input"
      }),
      depositRequiredFiles()
    );

    vi.spyOn(window, "setTimeout").mockImplementation((handler) => {
      if (typeof handler === "function") {
        hideNotice = handler as () => void;
      }

      return 1;
    });
    vi.spyOn(window, "clearTimeout").mockImplementation(() => undefined);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "심의 요청 제출" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const notice = screen.getByRole("status", { name: "심의 요청 등록 완료" });
    const flow = screen.getByRole("heading", { name: "신규 심의 요청" }).closest(".intake-flow");
    const orderedNodes = Array.from(
      flow?.querySelectorAll("h2, .submission-notice, input[aria-label='심의 요청 제목']") ?? []
    );

    expect(orderedNodes[0]).toHaveTextContent("신규 심의 요청");
    expect(orderedNodes[1]).toBe(notice);
    expect(orderedNodes[2]).toBe(screen.getByLabelText("심의 요청 제목"));

    act(() => hideNotice?.());

    expect(screen.queryByRole("status", { name: "심의 요청 등록 완료" })).not.toBeInTheDocument();
  });

  it("blocks unsupported real file uploads before calling the API", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<SamplePackageSelector />);

    expect(
      screen.getByText(
        "PDF, PNG, JPG/JPEG, TXT, DOCX, XLSX, CSV, HTML, ZIP · 최대 10개 · 일반 파일 25MB, ZIP 100MB 이하"
      )
    ).toBeInTheDocument();

    await user.upload(
      screen.getByLabelText("심의 대상 패키지를 업로드하세요 (ZIP, PDF, JPG)", {
        selector: "input"
      }),
      new File(["binary"], "malware.pdf", { type: "application/octet-stream" })
    );
    await user.click(screen.getByRole("button", { name: "심의 요청 제출" }));

    expect(screen.getByText("지원하지 않는 파일 형식입니다: malware.pdf")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks submission when required materials for the product type are missing", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<SamplePackageSelector />);

    await user.type(screen.getByLabelText("심의 요청 제목"), "예금 홍보물 심의");
    await user.type(screen.getByLabelText("계열사"), "광주은행");
    await user.type(screen.getByLabelText("요청 부서"), "디지털마케팅팀");
    await user.selectOptions(screen.getByLabelText("상품군"), "deposit");
    await user.type(screen.getByLabelText("게시 예정일"), "2026-06-20");
    await user.upload(
      screen.getByLabelText("심의 대상 패키지를 업로드하세요 (ZIP, PDF, JPG)", {
        selector: "input"
      }),
      new File(["poster"], "real-deposit-poster.png", { type: "image/png" })
    );

    expect(screen.getByRole("button", { name: "심의 요청 제출" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "심의 요청 제출" }));
    expect(fetchMock).not.toHaveBeenCalled();

    await user.upload(
      screen.getByLabelText("심의 대상 패키지를 업로드하세요 (ZIP, PDF, JPG)", {
        selector: "input"
      }),
      depositRequiredFiles()
    );

    expect(screen.getByRole("button", { name: "심의 요청 제출" })).toBeEnabled();
  });

  it("previews decomposed Korean filenames in ZIP archives as loan required materials", async () => {
    const user = userEvent.setup();

    render(<SamplePackageSelector />);

    await user.type(screen.getByLabelText("심의 요청 제목"), "대출 심의 패키지");
    await user.type(screen.getByLabelText("계열사"), "광주은행");
    await user.type(screen.getByLabelText("요청 부서"), "디지털마케팅팀");
    await user.selectOptions(screen.getByLabelText("상품군"), "loan");
    await user.type(screen.getByLabelText("게시 예정일"), "2026-06-20");
    await user.upload(
      screen.getByLabelText("심의 대상 패키지를 업로드하세요 (ZIP, PDF, JPG)", {
        selector: "input"
      }),
      await zipUploadFile({
        ".DS_Store": "metadata",
        ["01_홍보물_시안_모바일배너.pdf".normalize("NFD")]: "creative",
        ["02_원문카피_전체문안.pdf".normalize("NFD")]: "copy",
        ["03_상품설명서.pdf".normalize("NFD")]: "description",
        ["04_금리표_및_수수료.pdf".normalize("NFD")]: "rates",
        ["05_약관_대출조건_요약.pdf".normalize("NFD")]: "terms",
        ["06_내부_체크리스트.pdf".normalize("NFD")]: "checklist"
      })
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "심의 요청 제출" })).toBeEnabled()
    );
    expect(screen.queryByText((text) => text.includes(".DS_Store"))).not.toBeInTheDocument();
    expect(screen.queryByText("52%")).not.toBeInTheDocument();
  });

  it("blocks too many real files before calling the API", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<SamplePackageSelector />);

    await user.upload(
      screen.getByLabelText("심의 대상 패키지를 업로드하세요 (ZIP, PDF, JPG)", {
        selector: "input"
      }),
      Array.from(
        { length: 11 },
        (_, index) => new File(["poster"], `poster-${index}.png`, { type: "image/png" })
      )
    );
    await user.click(screen.getByRole("button", { name: "심의 요청 제출" }));

    expect(screen.getByText("최대 10개 파일까지 업로드할 수 있습니다.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("SamplePackageSelector stepper progression", () => {
  it("advances steps as the user fills metadata and selects files", async () => {
    const user = userEvent.setup();

    render(<SamplePackageSelector />);

    const initialItems = screen.getAllByRole("listitem");
    expect(initialItems[0]).toHaveAttribute("data-status", "active");

    await user.type(screen.getByLabelText("심의 요청 제목"), "테스트 심의");

    const itemsAfterTitle = screen.getAllByRole("listitem");
    expect(itemsAfterTitle[0]).toHaveAttribute("data-status", "done");
    expect(itemsAfterTitle[1]).toHaveAttribute("data-status", "active");

    await user.upload(
      screen.getByLabelText("심의 대상 패키지를 업로드하세요 (ZIP, PDF, JPG)", {
        selector: "input"
      }),
      new File(["poster"], "progress-poster.png", { type: "image/png" })
    );

    const itemsAfterFile = screen.getAllByRole("listitem");
    expect(itemsAfterFile[1]).toHaveAttribute("data-status", "done");
    expect(itemsAfterFile[2]).toHaveAttribute("data-status", "active");
  });
});
