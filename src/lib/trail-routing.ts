import type { LineString } from "geojson";
import { z } from "zod";
import { validateLineString } from "@/lib/tracks";

const coordinateSchema = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);

export const trailSegmentRequestSchema = z.object({
  start: coordinateSchema,
  end: coordinateSchema,
});

export const trailSnapRequestSchema = z.object({
  point: coordinateSchema,
});

const directionsResponseSchema = z.object({
  features: z
    .array(
      z.object({
        geometry: z.object({
          type: z.literal("LineString"),
          coordinates: z.array(z.array(z.number())),
        }),
      })
    )
    .min(1),
});

const snapResponseSchema = z.object({
  locations: z
    .array(
      z
        .object({
          location: coordinateSchema,
        })
        .nullable()
    )
    .min(1),
});

export type TrailCoordinate = z.infer<typeof coordinateSchema>;

export class TrailRoutingError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "TrailRoutingError";
    this.status = status;
  }
}

export function parseDirectionsGeometry(value: unknown): LineString {
  const parsed = directionsResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw new TrailRoutingError("The trail service returned an invalid route");
  }
  return validateLineString(parsed.data.features[0].geometry);
}

export function parseSnappedCoordinate(value: unknown): TrailCoordinate {
  const parsed = snapResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw new TrailRoutingError("The trail service returned an invalid snap result");
  }
  const coordinate = parsed.data.locations[0]?.location;
  if (!coordinate) {
    throw new TrailRoutingError("No mapped trail was found within 75 metres", 422);
  }
  return coordinate;
}

export async function requestTrailSnap({
  point,
  apiKey,
  fetcher = fetch,
  baseUrl = "https://api.openrouteservice.org",
}: {
  point: TrailCoordinate;
  apiKey: string;
  fetcher?: typeof fetch;
  baseUrl?: string;
}): Promise<TrailCoordinate> {
  if (!apiKey) {
    throw new TrailRoutingError("Trail following is not configured", 503);
  }

  const response = await fetcher(
    `${baseUrl.replace(/\/$/, "")}/v2/snap/foot-hiking/json`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ locations: [point], radius: 75 }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    }
  );

  if (!response.ok) {
    throw new TrailRoutingError(
      response.status === 400 || response.status === 404
        ? "No mapped trail was found within 75 metres"
        : "The trail service is temporarily unavailable",
      response.status === 400 || response.status === 404 ? 422 : 502
    );
  }

  return parseSnappedCoordinate(await response.json());
}

export async function requestTrailSegment({
  start,
  end,
  apiKey,
  fetcher = fetch,
  baseUrl = "https://api.openrouteservice.org",
}: {
  start: TrailCoordinate;
  end: TrailCoordinate;
  apiKey: string;
  fetcher?: typeof fetch;
  baseUrl?: string;
}): Promise<LineString> {
  if (!apiKey) {
    throw new TrailRoutingError("Trail following is not configured", 503);
  }

  const response = await fetcher(
    `${baseUrl.replace(/\/$/, "")}/v2/directions/foot-hiking/geojson`,
    {
      method: "POST",
      headers: {
        Accept: "application/geo+json, application/json",
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        coordinates: [start, end],
        radiuses: [75, 75],
        instructions: false,
        elevation: false,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    }
  );

  if (!response.ok) {
    const status = response.status === 404 || response.status === 400 ? 422 : 502;
    throw new TrailRoutingError(
      status === 422
        ? "No connected trail was found near those points"
        : "The trail service is temporarily unavailable",
      status
    );
  }

  return parseDirectionsGeometry(await response.json());
}
