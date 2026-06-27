import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CertificateEditorModal } from "./CertificateEditorModal";

const apiHeaders = (extra: Record<string, string> = {}) => ({
  "x-finproof-role": "reviewer",
  ...extra
});

const issuedCertificate = {
  id: "cert-1",
  reviewCaseId: "RC-1",
  certificateNumber: "FP-2026-ABC123",
  body: "심의 의견 본문",
  metadata: {
    title: "정기예금 홍보물",
    productType: "deposit",
    affiliateName: "광주은행",
    reviewerName: "준법심의자 박민준",
    approvedAt: "2026-06-01T00:00:00.000Z"
  },
  issuedByUserId: "user-1",
  issuedByName: "준법심의자 박민준",
  issuedAt: "2026-06-02T00:00:00.000Z",
  updatedAt: "2026-06-02T00:00:00.000Z",
  createdAt: "2026-06-02T00:00:00.000Z"
};

describe("CertificateEditorModal", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("issues a certificate for a not-yet-issued approved case", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: "Review certificate not found" })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ certificate: issuedCertificate })
      });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CertificateEditorModal
        caseId="RC-1"
        title="정기예금 홍보물"
        affiliateName="광주은행"
        apiHeaders={apiHeaders}
        onClose={() => undefined}
      />
    );

    const textarea = await screen.findByLabelText("심의 의견 본문");
    expect(screen.getByText("미발급")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "발급" })).toBeDisabled();

    await user.type(textarea, "심의 의견 본문");
    await user.click(screen.getByRole("button", { name: "발급" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/review-cases/RC-1/certificate",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ body: "심의 의견 본문" })
        })
      );
    });

    expect(
      await screen.findByText("심의필 FP-2026-ABC123 발급이 완료되었습니다.")
    ).toBeInTheDocument();
    expect(screen.getByText("FP-2026-ABC123")).toBeInTheDocument();
  });

  it("prefills the body and metadata from an existing certificate", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ certificate: issuedCertificate })
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CertificateEditorModal
        caseId="RC-1"
        title="정기예금 홍보물"
        affiliateName="광주은행"
        apiHeaders={apiHeaders}
        onClose={() => undefined}
      />
    );

    expect(await screen.findByLabelText("심의 의견 본문")).toHaveValue("심의 의견 본문");
    expect(screen.getByText("FP-2026-ABC123")).toBeInTheDocument();
    expect(screen.getByText("예금/적금")).toBeInTheDocument();
    expect(screen.getByText("준법심의자 박민준")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "저장" })).toBeEnabled();
  });

  it("surfaces a 409 error when the case is not approved", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: "Review certificate not found" })
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ error: "not approved" })
      });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CertificateEditorModal
        caseId="RC-1"
        title="정기예금 홍보물"
        affiliateName="광주은행"
        apiHeaders={apiHeaders}
        onClose={() => undefined}
      />
    );

    const textarea = await screen.findByLabelText("심의 의견 본문");
    await user.type(textarea, "본문");
    await user.click(screen.getByRole("button", { name: "발급" }));

    expect(
      await screen.findByText("승인된 케이스만 심의필을 발급할 수 있습니다.")
    ).toBeInTheDocument();
  });
});
