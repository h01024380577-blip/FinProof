import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SamplePackageSelector } from "./SamplePackageSelector";

describe("SamplePackageSelector", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows automatic classification and analysis entry after selecting a package", async () => {
    const user = userEvent.setup();
    render(<SamplePackageSelector />);

    expect(screen.getByText("샘플 패키지를 선택하세요")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "예금/적금 샘플 패키지 선택" }));

    expect(screen.getByText("파일 자동 분류 결과")).toBeInTheDocument();
    expect(screen.getByText("deposit-poster.png")).toBeInTheDocument();
    expect(screen.getByText("약관")).toBeInTheDocument();
    expect(screen.getByText("내부 체크리스트")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "AI 분석 시작" })).toHaveAttribute(
      "href",
      "/reviews/rc-demo-deposit-001"
    );
  });

  it("uploads real files, shows deterministic classification, and exposes analysis start", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          reviewCaseId: "rc-upload-001",
          status: "analysis_complete",
          analysisHref: "/reviews/rc-upload-001",
          analysisNotice: "실제 업로드 건은 OCR/RAG 분석 전이므로 근거 부족 상태로 표시됩니다."
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<SamplePackageSelector />);

    await user.click(screen.getByRole("button", { name: "실제 자료 업로드" }));
    await user.type(screen.getByLabelText("심의 제목"), "실제 업로드 적금 홍보물");
    await user.upload(
      screen.getByLabelText("자료 파일"),
      new File(["poster"], "real-deposit-poster.png", { type: "image/png" })
    );
    await user.click(screen.getByRole("button", { name: "업로드 생성" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/review-cases",
      expect.objectContaining({
        method: "POST",
        body: expect.any(FormData)
      })
    );
    expect(screen.getByText("real-deposit-poster.png")).toBeInTheDocument();
    expect(screen.getAllByText("홍보물 시안").length).toBeGreaterThan(0);
    expect(screen.getAllByText("내부 체크리스트").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "실제 자료 분석 시작" }));

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/v1/review-cases/rc-upload-001/analysis/start",
      expect.objectContaining({ method: "POST" })
    );
    expect(screen.getByRole("link", { name: "생성된 심의 건 열기" })).toHaveAttribute(
      "href",
      "/reviews/rc-upload-001"
    );
    expect(screen.getByText(/OCR\/RAG 분석 전/)).toBeInTheDocument();
  });

  it("blocks unsupported real file uploads before calling the API", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<SamplePackageSelector />);

    await user.click(screen.getByRole("button", { name: "실제 자료 업로드" }));
    expect(
      screen.getByText(
        "PDF, PNG, JPG/JPEG, TXT, DOCX, XLSX, CSV, HTML, ZIP · 최대 10개 · 일반 파일 25MB, ZIP 100MB 이하"
      )
    ).toBeInTheDocument();

    await user.upload(
      screen.getByLabelText("자료 파일"),
      new File(["binary"], "malware.pdf", { type: "application/octet-stream" })
    );
    await user.click(screen.getByRole("button", { name: "업로드 생성" }));

    expect(screen.getByText("지원하지 않는 파일 형식입니다: malware.pdf")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks too many real files before calling the API", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<SamplePackageSelector />);

    await user.click(screen.getByRole("button", { name: "실제 자료 업로드" }));
    await user.upload(
      screen.getByLabelText("자료 파일"),
      Array.from(
        { length: 11 },
        (_, index) => new File(["poster"], `poster-${index}.png`, { type: "image/png" })
      )
    );
    await user.click(screen.getByRole("button", { name: "업로드 생성" }));

    expect(screen.getByText("최대 10개 파일까지 업로드할 수 있습니다.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
