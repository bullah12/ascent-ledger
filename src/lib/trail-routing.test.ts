import { describe, expect, it, vi } from "vitest";
import {
  parseDirectionsGeometry,
  parseSnappedCoordinate,
  requestTrailSegment,
  requestTrailSnap,
  trailSegmentRequestSchema,
} from "./trail-routing";

const responseGeometry = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [
          [-3.001, 56.001],
          [-3.002, 56.002],
          [-3.003, 56.003],
        ],
      },
    },
  ],
};

describe("trail routing", () => {
  it("validates WGS84 segment coordinates", () => {
    expect(
      trailSegmentRequestSchema.safeParse({
        start: [-3, 56],
        end: [-3.1, 56.1],
      }).success
    ).toBe(true);
    expect(
      trailSegmentRequestSchema.safeParse({
        start: [-3, 91],
        end: [-3.1, 56.1],
      }).success
    ).toBe(false);
  });

  it("extracts and validates GeoJSON returned by openrouteservice", () => {
    expect(parseDirectionsGeometry(responseGeometry)).toEqual(
      responseGeometry.features[0].geometry
    );
    expect(() => parseDirectionsGeometry({ features: [] })).toThrow(
      "invalid route"
    );
  });

  it("parses a snapped trail coordinate and rejects a miss", () => {
    expect(
      parseSnappedCoordinate({
        locations: [{ location: [-3.002, 56.002], snapped_distance: 4.2 }],
      })
    ).toEqual([-3.002, 56.002]);
    expect(() => parseSnappedCoordinate({ locations: [null] })).toThrow(
      "within 75 metres"
    );
  });

  it("requests a hiking route with a bounded snap radius", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify(responseGeometry), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await requestTrailSegment({
      start: [-3, 56],
      end: [-3.1, 56.1],
      apiKey: "test-key",
      fetcher,
    });

    expect(result.coordinates).toHaveLength(3);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(
      "https://api.openrouteservice.org/v2/directions/foot-hiking/geojson"
    );
    expect(init?.headers).toMatchObject({ Authorization: "test-key" });
    expect(JSON.parse(String(init?.body))).toMatchObject({ radiuses: [75, 75] });
  });

  it("snaps a newly placed point before another waypoint exists", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({ locations: [{ location: [-3.002, 56.002] }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    await expect(
      requestTrailSnap({
        point: [-3, 56],
        apiKey: "test-key",
        fetcher,
      })
    ).resolves.toEqual([-3.002, 56.002]);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(
      "https://api.openrouteservice.org/v2/snap/foot-hiking/json"
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      locations: [[-3, 56]],
      radius: 75,
    });
  });

  it("fails clearly when trail routing is not configured", async () => {
    await expect(
      requestTrailSegment({
        start: [-3, 56],
        end: [-3.1, 56.1],
        apiKey: "",
      })
    ).rejects.toMatchObject({
      message: "Trail following is not configured",
      status: 503,
    });
  });
});
