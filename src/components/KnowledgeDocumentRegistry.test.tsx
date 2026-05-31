import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KnowledgeDocumentRegistry } from "./KnowledgeDocumentRegistry";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve: Deferred<T>["resolve"] = () => {};
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
}

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
    expect(screen.queryByText("초안")).not.toBeInTheDocument();
  });

  it("shows a spinner while registering a knowledge document", async () => {
    const user = userEvent.setup();
    const createRequest = createDeferred<{
      ok: boolean;
      json: () => Promise<{
        document: {
          id: string;
          title: string;
          version: string;
          documentType: string;
          productType: string;
          effectiveFrom: string;
          approvalStatus: string;
          storageKey: string;
          createdAt: string;
        };
        ingestion: {
          chunkCount: number;
          embeddingModel: string;
        };
      }>;
    }>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ documents: [] })
      })
      .mockReturnValueOnce(createRequest.promise);
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

    const pendingButton = await screen.findByRole("button", { name: "등록중" });
    expect(pendingButton).toBeDisabled();
    expect(pendingButton.querySelector(".action-spinner")).toBeInTheDocument();

    createRequest.resolve({
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
          embeddingModel: "text-embedding-3-small"
        }
      })
    });

    expect(await screen.findByText("등록 완료 · 1개 청크 임베딩 저장")).toBeInTheDocument();
  });

  it("shows a spinner while approving a draft knowledge document", async () => {
    const user = userEvent.setup();
    const approveRequest = createDeferred<{
      ok: boolean;
      json: () => Promise<{
        document: {
          id: string;
          title: string;
          version: string;
          documentType: string;
          productType: string;
          effectiveFrom: string;
          approvalStatus: string;
          approvedAt: string;
          approvedBy: string;
          storageKey: string;
          createdAt: string;
        };
      }>;
    }>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          documents: [
            {
              id: "knowledge-001",
              title: "예금 광고 심의 지침",
              version: "2026.05",
              documentType: "internal_policy",
              productType: "deposit",
              effectiveFrom: "2026-05-01",
              approvalStatus: "draft",
              storageKey: "local/knowledge-documents/knowledge-001/deposit-policy.txt",
              createdAt: "2026-05-26T00:00:00.000Z"
            }
          ]
        })
      })
      .mockReturnValueOnce(approveRequest.promise);
    vi.stubGlobal("fetch", fetchMock);

    render(<KnowledgeDocumentRegistry />);

    await user.click(await screen.findByRole("button", { name: "승인" }));

    const pendingButton = await screen.findByRole("button", { name: "승인중" });
    expect(pendingButton).toBeDisabled();
    expect(pendingButton.querySelector(".action-spinner")).toBeInTheDocument();

    approveRequest.resolve({
      ok: true,
      json: async () => ({
        document: {
          id: "knowledge-001",
          title: "예금 광고 심의 지침",
          version: "2026.05",
          documentType: "internal_policy",
          productType: "deposit",
          effectiveFrom: "2026-05-01",
          approvalStatus: "approved",
          approvedAt: "2026-05-27T00:00:00.000Z",
          approvedBy: "user-reviewer-demo",
          storageKey: "local/knowledge-documents/knowledge-001/deposit-policy.txt",
          createdAt: "2026-05-26T00:00:00.000Z"
        }
      })
    });

    expect(await screen.findByText("승인 완료")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "승인해제" })).toBeInTheDocument();
  });

  it("unapproves an approved knowledge document from the list", async () => {
    const user = userEvent.setup();
    const unapproveRequest = createDeferred<{
      ok: boolean;
      json: () => Promise<{
        document: {
          id: string;
          title: string;
          version: string;
          documentType: string;
          productType: string;
          effectiveFrom: string;
          approvalStatus: string;
          storageKey: string;
          createdAt: string;
        };
      }>;
    }>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          documents: [
            {
              id: "knowledge-001",
              title: "예금 광고 심의 지침",
              version: "2026.05",
              documentType: "internal_policy",
              productType: "deposit",
              effectiveFrom: "2026-05-01",
              approvalStatus: "approved",
              approvedAt: "2026-05-27T00:00:00.000Z",
              approvedBy: "user-reviewer-demo",
              storageKey: "local/knowledge-documents/knowledge-001/deposit-policy.txt",
              createdAt: "2026-05-26T00:00:00.000Z"
            }
          ]
        })
      })
      .mockReturnValueOnce(unapproveRequest.promise);
    vi.stubGlobal("fetch", fetchMock);

    render(<KnowledgeDocumentRegistry />);

    expect(await screen.findByText("승인")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "승인해제" }));

    const pendingButton = await screen.findByRole("button", { name: "승인해제중" });
    expect(pendingButton).toBeDisabled();
    expect(pendingButton.querySelector(".action-spinner")).toBeInTheDocument();

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/v1/knowledge-documents/knowledge-001/approve",
      expect.objectContaining({
        method: "DELETE"
      })
    );

    unapproveRequest.resolve({
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
        }
      })
    });

    expect(await screen.findByText("승인해제 완료")).toBeInTheDocument();
    expect(screen.queryByText("초안")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "승인" })).toBeInTheDocument();
  });

  it("deletes a registered knowledge document from the list", async () => {
    const user = userEvent.setup();
    const deleteRequest = createDeferred<{
      ok: boolean;
      json: () => Promise<{
        deleted: boolean;
        documentId: string;
      }>;
    }>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          documents: [
            {
              id: "knowledge-001",
              title: "예금 광고 심의 지침",
              version: "2026.05",
              documentType: "internal_policy",
              productType: "deposit",
              effectiveFrom: "2026-05-01",
              approvalStatus: "draft",
              storageKey: "local/knowledge-documents/knowledge-001/deposit-policy.txt",
              createdAt: "2026-05-26T00:00:00.000Z"
            }
          ]
        })
      })
      .mockReturnValueOnce(deleteRequest.promise);
    vi.stubGlobal("fetch", fetchMock);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<KnowledgeDocumentRegistry />);

    expect(await screen.findByText("예금 광고 심의 지침")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "삭제" }));

    expect(confirmSpy).toHaveBeenCalledWith("예금 광고 심의 지침 지식문서를 삭제할까요?");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/v1/knowledge-documents/knowledge-001",
      expect.objectContaining({
        method: "DELETE"
      })
    );

    const pendingButton = await screen.findByRole("button", { name: "삭제중" });
    expect(pendingButton).toBeDisabled();
    expect(pendingButton.querySelector(".action-spinner")).toBeInTheDocument();

    deleteRequest.resolve({
      ok: true,
      json: async () => ({
        deleted: true,
        documentId: "knowledge-001"
      })
    });

    expect(await screen.findByText("삭제 완료")).toBeInTheDocument();
    expect(screen.queryByText("예금 광고 심의 지침")).not.toBeInTheDocument();
    expect(screen.getByText("아직 등록된 지식문서가 없습니다.")).toBeInTheDocument();
  });

  it("renders the registered document list as a bounded scroll region", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        documents: Array.from({ length: 8 }, (_, index) => ({
          id: `knowledge-${index + 1}`,
          title: `승인 지식문서 ${index + 1}`,
          version: "2026.05",
          documentType: "internal_policy",
          productType: "deposit",
          effectiveFrom: "2026-05-01",
          approvalStatus: "approved",
          approvedAt: "2026-05-27T00:00:00.000Z",
          approvedBy: "user-reviewer-demo",
          storageKey: `local/knowledge-documents/knowledge-${index + 1}/policy.txt`,
          createdAt: "2026-05-26T00:00:00.000Z"
        }))
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<KnowledgeDocumentRegistry />);

    const listRegion = await screen.findByRole("region", { name: "등록된 지식문서" });
    expect(listRegion).toHaveClass("knowledge-list--bounded");
    expect(listRegion).toHaveAttribute("tabindex", "0");
    expect(await screen.findByText("승인 지식문서 8")).toBeInTheDocument();
  });
});
