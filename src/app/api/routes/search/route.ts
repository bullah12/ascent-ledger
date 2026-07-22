import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { APPROVED_PUBLIC_ROUTE_WHERE } from "@/lib/routes/quality-policy";

// Name search over the Route table for the logbook's "link a route" picker.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) {
    return NextResponse.json({ routes: [] });
  }

  const [routes, customTrails] = await Promise.all([prisma.route.findMany({
    where: { ...APPROVED_PUBLIC_ROUTE_WHERE, name: { contains: query, mode: "insensitive" } },
    include: { area: { select: { name: true } } },
    orderBy: { name: "asc" },
    take: 10,
  }), prisma.customTrail.findMany({
    where: { ownerId: user.id, name: { contains: query, mode: "insensitive" } },
    orderBy: { name: "asc" }, take: 10,
  })]);

  return NextResponse.json({
    routes: [...routes.map((route) => ({
      id: route.id,
      kind: "canonical" as const,
      name: route.name,
      discipline: route.discipline,
      gradeRaw: route.gradeRaw,
      areaName: route.area?.name ?? null,
    })), ...customTrails.map((trail) => ({
      id: trail.id, kind: "custom" as const, name: trail.name,
      discipline: trail.discipline, gradeRaw: trail.gradeRaw, areaName: trail.areaName,
    }))].slice(0, 10),
  });
}
