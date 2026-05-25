import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SamplePackageSelector } from "./SamplePackageSelector";

describe("SamplePackageSelector", () => {
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
});
