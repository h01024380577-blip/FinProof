import { NextResponse } from "next/server";
import { getSamplePackages } from "@/domain/intake";

export async function GET() {
  return NextResponse.json({ packages: getSamplePackages() });
}
