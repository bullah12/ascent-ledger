import { describe, expect, it } from "vitest";
import {
  MAX_STORED_TRACK_POINTS,
  TrackError,
  parseSubmittedTrack,
  parseTrackText,
  simplifyTrack,
  trackFormatFromFilename,
  validateLineString,
} from "./tracks";

describe("track geometry", () => {
  it("detects only supported file formats", () => {
    expect(trackFormatFromFilename("RIDGE.GPX")).toBe("gpx");
    expect(trackFormatFromFilename("route.kml")).toBe("kml");
    expect(trackFormatFromFilename("route.fit")).toBeNull();
  });

  it("parses GPX track points in document order", () => {
    const geometry = parseTrackText(
      `<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg><trkpt lat="56.1" lon="-5.2"/><trkpt lat="56.2" lon="-5.1"/></trkseg></trk></gpx>`,
      "gpx"
    );
    expect(geometry).toEqual({
      type: "LineString",
      coordinates: [[-5.2, 56.1], [-5.1, 56.2]],
    });
  });

  it("parses KML LineStrings", () => {
    const geometry = parseTrackText(
      `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><LineString><coordinates>-4.1,55.1,0 -4.0,55.2,20</coordinates></LineString></Placemark></kml>`,
      "kml"
    );
    expect(geometry.coordinates).toEqual([[-4.1, 55.1], [-4, 55.2]]);
  });

  it("simplifies large tracks to the storage budget while keeping endpoints", () => {
    const source = Array.from({ length: 5_000 }, (_, index) => [
      -5 + index / 100_000,
      56 + Math.sin(index / 20) / 1_000,
    ]);
    const simplified = simplifyTrack(source);
    expect(simplified.coordinates.length).toBeLessThanOrEqual(MAX_STORED_TRACK_POINTS);
    expect(simplified.coordinates[0]).toEqual([-5, 56]);
    expect(simplified.coordinates.at(-1)).toEqual([
      Number((-5 + 4_999 / 100_000).toFixed(6)),
      Number((56 + Math.sin(4_999 / 20) / 1_000).toFixed(6)),
    ]);
  });

  it("rejects invalid or out-of-range submitted geometry", () => {
    expect(() => validateLineString({ type: "Point", coordinates: [0, 0] })).toThrow(TrackError);
    expect(() =>
      parseSubmittedTrack(JSON.stringify({ type: "LineString", coordinates: [[0, 91], [0, 0]] }))
    ).toThrow("WGS84");
  });
});
