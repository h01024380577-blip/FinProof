import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KnowledgeDocumentRegistry } from "./KnowledgeDocumentRegistry";

describe("KnowledgeDocumentRegistry", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a knowledge document attachment through the backend API", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ documents: [] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          document: {
            id: "knowledge-001",
            title: "예금 광고 심의 지침",
            version: "2026.05",
            documentType: "internal_policy",
            productType: "deposit",
            effectiveFrom: "2026-05-01",
            approvalStatus: "draft",
            storageKey: "local/knowledge-documents/knowledge-001/deposit-policy.txt",
            createdAt: "2026-05-26T00:00:00.000Z"
          },
          ingestion: {
            chunkCount: 1,
            embeddingModel: "deterministic-embedding"
          }
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<KnowledgeDocumentRegistry />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/v1/knowledge-documents"));
    await user.type(screen.getByLabelText("문서 제목"), "예금 광고 심의 지침");
    await user.type(screen.getByLabelText("버전"), "2026.05");
    await user.selectOptions(screen.getByLabelText("문서 유형"), "internal_policy");
    await user.selectOptions(screen.getByLabelText("상품군"), "deposit");
    await user.type(screen.getByLabelText("시행일"), "2026-05-01");
    await user.upload(
      screen.getByLabelText("지식문서 첨부파일", { selector: "input" }),
      new File(["최고 금리 표현은 조건과 한도를 함께 고지합니다."], "deposit-policy.txt", {
        type: "text/plain"
      })
    );
    await user.click(screen.getByRole("button", { name: "지식문서 등록" }));

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/v1/knowledge-documents",
      expect.objectContaining({
        method: "POST",
        body: expect.any(FormData)
      })
    );
    expect(await screen.findByText("등록 완료 · 1개 청크 임베딩 저장")).toBeInTheDocument();
    expect(screen.getByText("예금 광고 심의 지침")).toBeInTheDocument();
    expect(screen.getByText("초안")).toBeInTheDocument();
  });
});
