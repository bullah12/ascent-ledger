import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  requestTrailSegment,
  requestTrailSnap,
  TrailRoutingError,
  trailSegmentRequestSchema,
  trailSnapRequestSchema,
} from "@/lib/trail-routing";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const apiKey = process.env.OPENROUTESERVICE_API_KEY ?? "";
    const baseUrl =
      process.env.OPENROUTESERVICE_BASE_URL ??
      "https://api.openrouteservice.org";
    const snapInput = trailSnapRequestSchema.safeParse(body);
    if (snapInput.success) {
      const coordinate = await requestTrailSnap({
        ...snapInput.data,
        apiKey,
        baseUrl,
      });
      return NextResponse.json({ coordinate });
    }

    const segmentInput = trailSegmentRequestSchema.safeParse(body);
    if (!segmentInput.success) {
      return NextResponse.json({ error: "Invalid trail coordinates" }, { status: 400 });
    }
    const geometry = await requestTrailSegment({
      ...segmentInput.data,
      apiKey,
      baseUrl,
    });
    return NextResponse.json({ geometry });
  } catch (caught) {
    const error =
      caught instanceof TrailRoutingError
        ? caught
        : new TrailRoutingError("The trail service is temporarily unavailable");
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
}
