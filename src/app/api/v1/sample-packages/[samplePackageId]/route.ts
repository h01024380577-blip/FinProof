import { NextResponse } from "next/server";
import { buildSamplePackagePreview, getRequiredMaterialRows } from "@/domain/intake";
import { sampleDataEnabled } from "@/server/reviews/sample-data";
import { jsonError, type RouteContext } from "@/server/reviews/route-utils";

function getRepresentedMissingKeys(
  materialRows: ReturnType<typeof getRequiredMaterialRows>
): Set<string> {
  return new Set(
    materialRows
      .filter((row) => row.status === "missing")
      .flatMap((row) => [
        row.fileType,
        row.fileType === "checklist" ? "internal_checklist" : row.fileType
      ])
  );
}

export async function GET(_request: Request, context: RouteContext<{ samplePackageId: string }>) {
  if (!sampleDataEnabled()) {
    return jsonError("Sample packages are disabled", 404, "SAMPLE_DATA_DISABLED");
  }

  const { samplePackageId } = await context.params;
  const preview = buildSamplePackagePreview(samplePackageId);

  if (!preview) {
    return jsonError("Sample package not found", 404);
  }

  const requiredMaterials = getRequiredMaterialRows(preview);
  const representedMissingKeys = getRepresentedMissingKeys(requiredMaterials);
  const extraMissingMaterials = preview.missingMaterials.filter(
    (material) => !representedMissingKeys.has(material)
  );

  return NextResponse.json({
    preview,
    requiredMaterials,
    extraMissingMaterials
  });
}
