"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import {
  TerraDraw,
  TerraDrawLineStringMode,
  TerraDrawSelectMode,
  type GeoJSONStoreFeatures,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import type { LineString } from "geojson";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  TrackError,
  lineBounds,
  parseTrackFile,
  pathSourceForFormat,
  validateLineString,
  type TrackPathSource,
} from "@/lib/tracks";
import "maplibre-gl/dist/maplibre-gl.css";

const MAX_TRACK_BYTES = 5 * 1024 * 1024;

function drawFeature(geometry: LineString): GeoJSONStoreFeatures {
  return {
    id: crypto.randomUUID(),
    type: "Feature",
    geometry,
    properties: { mode: "linestring" },
  };
}

export function TrackEditor({
  initialGeometry = null,
  initialSource = null,
  existingRawUrl = null,
}: {
  initialGeometry?: LineString | null;
  initialSource?: TrackPathSource | null;
  existingRawUrl?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const syncingRef = useRef(false);
  const initialGeometryRef = useRef(initialGeometry);

  const [geometry, setGeometry] = useState<LineString | null>(initialGeometry);
  const [source, setSource] = useState<TrackPathSource | null>(initialSource);
  const [message, setMessage] = useState<string | null>(
    initialGeometry ? `${initialGeometry.coordinates.length} stored track points` : null
  );
  const [error, setError] = useState<string | null>(null);
  const [removeRaw, setRemoveRaw] = useState(false);

  function fitToGeometry(next: LineString) {
    const map = mapRef.current;
    if (!map) return;
    const [southWest, northEast] = lineBounds(next);
    map.fitBounds([southWest, northEast], { padding: 40, maxZoom: 15, duration: 300 });
  }

  function replaceDrawGeometry(next: LineString | null, nextSource: TrackPathSource | null) {
    const draw = drawRef.current;
    syncingRef.current = true;
    if (draw?.enabled) {
      draw.clear();
      if (next) {
        const [result] = draw.addFeatures([drawFeature(next)]);
        if (!result?.valid) {
          syncingRef.current = false;
          setError(result?.reason ?? "Could not display this track");
          return;
        }
        draw.setMode("select");
      }
    }
    setGeometry(next);
    setSource(nextSource);
    syncingRef.current = false;
    if (next) fitToGeometry(next);
  }

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [-3.5, 54.5],
      zoom: 4.5,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [
          new TerraDrawLineStringMode({
            styles: {
              lineStringColor: "#7c3aed",
              lineStringWidth: 4,
              coordinatePointColor: "#7c3aed",
              coordinatePointOutlineColor: "#ffffff",
            },
          }),
          new TerraDrawSelectMode({
            flags: {
              linestring: {
                feature: {
                  draggable: false,
                  coordinates: {
                    midpoints: true,
                    draggable: true,
                    deletable: true,
                  },
                },
              },
            },
          }),
        ],
      });
      draw.start();
      drawRef.current = draw;

      const syncFromDraw = () => {
        if (syncingRef.current) return;
        const feature = draw
          .getSnapshot()
          .find((item) => item.geometry.type === "LineString");
        if (!feature) {
          setGeometry(null);
          return;
        }
        try {
          const next = validateLineString(feature.geometry);
          setGeometry(next);
          setSource("drawn");
          setMessage(`${next.coordinates.length} track points`);
          setError(null);
        } catch {
          // A one-point in-progress drawing is not a storable LineString yet.
        }
      };

      draw.on("change", syncFromDraw);
      draw.on("finish", () => {
        syncFromDraw();
        draw.setMode("select");
      });

      const initial = initialGeometryRef.current;
      if (initial) {
        syncingRef.current = true;
        const [result] = draw.addFeatures([drawFeature(initial)]);
        syncingRef.current = false;
        if (result?.valid) {
          draw.setMode("select");
          fitToGeometry(initial);
        } else {
          setError(result?.reason ?? "Could not display the stored track");
        }
      }
    });

    return () => {
      if (drawRef.current?.enabled) drawRef.current.stop();
      drawRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.size > MAX_TRACK_BYTES) {
      setError("Track file is over 5 MB");
      return;
    }
    try {
      const parsed = await parseTrackFile(file);
      replaceDrawGeometry(parsed.geometry, pathSourceForFormat(parsed.format));
      setMessage(
        `${parsed.format.toUpperCase()} ready · ${parsed.geometry.coordinates.length} simplified points`
      );
      setRemoveRaw(false);
    } catch (caught) {
      setError(caught instanceof TrackError ? caught.message : "Could not parse this track file");
    }
  }

  function startDrawing() {
    const draw = drawRef.current;
    if (!draw?.enabled) return;
    replaceDrawGeometry(null, "drawn");
    setMessage("Click points on the map, then click the last point again to finish");
    setError(null);
    draw.setMode("linestring");
  }

  function editGeometry() {
    const draw = drawRef.current;
    if (!draw?.enabled || !geometry) return;
    setSource("drawn");
    draw.setMode("select");
    const feature = draw.getSnapshot().find((item) => item.geometry.type === "LineString");
    if (feature?.id !== undefined) draw.selectFeature(feature.id);
    setMessage("Drag points or midpoints to edit the line");
  }

  function clearGeometry() {
    replaceDrawGeometry(null, null);
    setMessage(null);
    setError(null);
    setRemoveRaw(Boolean(existingRawUrl));
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <section className="grid gap-3 rounded-lg border p-3">
      <input
        type="hidden"
        name="pathGeojson"
        value={geometry ? JSON.stringify(geometry) : ""}
      />
      <input type="hidden" name="pathSource" value={source ?? ""} />
      {removeRaw && <input type="hidden" name="removeTrackFile" value="on" />}

      <div>
        <Label htmlFor="trackFile">Route or approach track</Label>
        <p className="text-xs text-muted-foreground">
          Draw a line or import GPX/KML. Tracks are simplified to at most 1,000 points.
        </p>
      </div>

      <Input
        ref={fileRef}
        id="trackFile"
        name="trackFile"
        type="file"
        accept=".gpx,.kml,application/gpx+xml,application/vnd.google-earth.kml+xml"
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />

      {existingRawUrl && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <a href={existingRawUrl} className="underline" target="_blank" rel="noreferrer">
            Download original track
          </a>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={removeRaw}
              onChange={(event) => setRemoveRaw(event.target.checked)}
            />
            remove original file on save
          </label>
        </div>
      )}

      <div className="relative">
        <div ref={containerRef} className="h-72 w-full rounded-md border" />
        <div className="absolute bottom-2 left-2 flex flex-wrap gap-1 rounded-md bg-background/90 p-1 shadow-sm">
          <Button type="button" size="sm" onClick={startDrawing}>
            {geometry ? "Replace by drawing" : "Draw line"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!geometry}
            onClick={editGeometry}
          >
            Edit points
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!geometry && !existingRawUrl}
            onClick={clearGeometry}
          >
            Clear track
          </Button>
        </div>
      </div>

      {message && <p className="text-xs text-muted-foreground">{message}</p>}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
