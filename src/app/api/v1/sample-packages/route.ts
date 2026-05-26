import { NextResponse } from "next/server";
import { getSamplePackages } from "@/domain/intake";
import { sampleDataEnabled } from "@/server/reviews/sample-data";
import { jsonError } from "@/server/reviews/route-utils";

export async function GET() {
  if (!sampleDataEnabled()) {
    return jsonError("Sample packages are disabled", 404, "SAMPLE_DATA_DISABLED");
  }

  return NextResponse.json({ packages: getSamplePackages() });
}
