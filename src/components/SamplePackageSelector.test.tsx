import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SamplePackageSelector } from "./SamplePackageSelector";

describe("SamplePackageSelector", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
    expect(screen.getByRole("option", { name: "계열사를 선택하세요" })).toBeInTheDocument();
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
    await user.selectOptions(screen.getByLabelText("계열사"), "광주은행");
    await user.type(screen.getByLabelText("요청 부서"), "디지털마케팅팀");
    await user.selectOptions(screen.getByLabelText("상품군"), "deposit");
    await user.type(screen.getByLabelText("게시 예정일"), "2026-06-20");
    await user.click(screen.getByLabelText("모바일 앱"));
    await user.type(screen.getByLabelText("요청 메모"), "금리 조건 표시를 검토해 주세요.");
    await user.upload(
      screen.getByLabelText("심의 대상 패키지를 업로드하세요 (ZIP, PDF, JPG)", {
        selector: "input"
      }),
      new File(["poster"], "real-deposit-poster.png", { type: "image/png" })
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
    expect(screen.getByText("심의 큐에 분석 대기 건으로 등록되었습니다.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "심의 큐에서 확인" })).toHaveAttribute(
      "href",
      "/reviews"
    );
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
