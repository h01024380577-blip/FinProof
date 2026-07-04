import { createReviewService } from "@/server/reviews/review-service";
import { jsonError, requestContext, type RouteContext } from "@/server/reviews/route-utils";
import { getReviewStorageAdapter } from "@/server/storage";
import { classifyUnservableFile } from "@/server/storage/upload-consistency";

function contentDisposition(fileName: string) {
  return `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(
  request: Request,
  context: RouteContext<{ caseId: string; fileId: string }>
) {
  const { caseId, fileId } = await context.params;
  const reviewCase = await createReviewService().getReviewCase(await requestContext(request), caseId);

  if (!reviewCase) {
    return jsonError("Review case not found", 404);
  }

  const file = reviewCase.files.find((candidate) => candidate.id === fileId);

  if (!file?.storageKey) {
    return jsonError("Review file not found", 404);
  }

  const body = await getReviewStorageAdapter().getReviewFileBody(file.storageKey);

  if (!body) {
    // A silent 404 here previously hid orphaned files (metadata present, bytes
    // unreachable by the serving adapter). Emit one structured line so CloudWatch
    // Logs Insights surfaces the reason and the offending case/file.
    const reason = classifyUnservableFile(process.env, file.storageProvider);
    try {
      console.warn(
        JSON.stringify({
          evt: "storage",
          level: "warn",
          ts: new Date().toISOString(),
          reason,
          case: caseId,
          file: fileId,
          storageProvider: file.storageProvider,
          storageKey: file.storageKey
        })
      );
    } catch {
      // observability must not affect serving
    }

    return jsonError("Review file content not found", 404);
  }

  const responseBody = body.buffer.slice(
    body.byteOffset,
    body.byteOffset + body.byteLength
  ) as ArrayBuffer;

  return new Response(responseBody, {
    headers: {
      "cache-control": "private, max-age=60",
      "content-disposition": contentDisposition(file.name),
      "content-type": file.contentType ?? "application/octet-stream"
    }
  });
}
