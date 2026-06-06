import JSZip from "jszip";
import { expandArchiveUploads, UnsafeArchiveError } from "./archive-extraction";

async function zipBody(entries: Record<string, string>) {
  const zip = new JSZip();

  for (const [name, content] of Object.entries(entries)) {
    zip.file(name, content);
  }

  return zip.generateAsync({ type: "uint8array" });
}

describe("archive upload extraction", () => {
  it("keeps the original ZIP and expands safe review files", async () => {
    const files = await expandArchiveUploads([
      {
        name: "review-package.zip",
        type: "application/zip",
        size: 4096,
        body: await zipBody({
          "poster.png": "poster",
          "rates/rate-table.csv": "rate,5.0"
        })
      }
    ]);

    expect(files.map((file) => file.name)).toEqual([
      "review-package.zip",
      "review-package.zip/poster.png",
      "review-package.zip/rates/rate-table.csv"
    ]);
    expect(files.map((file) => file.type)).toEqual(["application/zip", "image/png", "text/csv"]);
    expect(files[1].sourceArchiveName).toBe("review-package.zip");
  });

  it("skips macOS metadata entries when expanding review package archives", async () => {
    const files = await expandArchiveUploads([
      {
        name: "review-package.zip",
        type: "application/zip",
        size: 4096,
        body: await zipBody({
          ".DS_Store": "metadata",
          "__MACOSX/._poster.png": "resource fork",
          "nested/._rate-table.csv": "resource fork",
          "poster.png": "poster",
          "nested/rate-table.csv": "rate,5.0"
        })
      }
    ]);

    expect(files.map((file) => file.name)).toEqual([
      "review-package.zip",
      "review-package.zip/poster.png",
      "review-package.zip/nested/rate-table.csv"
    ]);
  });

  it("rejects ZIP entries with unsafe paths", async () => {
    await expect(
      expandArchiveUploads([
        {
          name: "review-package.zip",
          type: "application/zip",
          size: 4096,
          body: await zipBody({
            "../escape.png": "poster"
          })
        }
      ])
    ).rejects.toThrow(UnsafeArchiveError);
  });
});
