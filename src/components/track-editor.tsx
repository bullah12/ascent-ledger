"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import {
  TerraDraw,
  TerraDrawLineStringMode,
  TerraDrawSelectMode,
  type GeoJSONStoreFeatures,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import type { LineString, Position } from "geojson";
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

type SmartWaypoint = {
  id: string;
  coordinate: [number, number];
  manual: boolean;
};

class TrailSegmentError extends Error {}

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
  const smartModeRef = useRef(false);
  const smartWaypointsRef = useRef<SmartWaypoint[]>([]);
  const smartMarkersRef = useRef<maplibregl.Marker[]>([]);
  const routingRef = useRef(false);
  const routeGenerationRef = useRef(0);

  const [geometry, setGeometry] = useState<LineString | null>(initialGeometry);
  const [source, setSource] = useState<TrackPathSource | null>(initialSource);
  const [message, setMessage] = useState<string | null>(
    initialGeometry ? `${initialGeometry.coordinates.length} stored track points` : null
  );
  const [error, setError] = useState<string | null>(null);
  const [removeRaw, setRemoveRaw] = useState(false);
  const [smartDrawing, setSmartDrawing] = useState(false);
  const [routing, setRouting] = useState(false);

  function fitToGeometry(next: LineString) {
    const map = mapRef.current;
    if (!map) return;
    const [southWest, northEast] = lineBounds(next);
    map.fitBounds([southWest, northEast], { padding: 40, maxZoom: 15, duration: 300 });
  }

  function replaceDrawGeometry(
    next: LineString | null,
    nextSource: TrackPathSource | null,
    shouldFit = true
  ) {
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
    if (next && shouldFit) fitToGeometry(next);
  }

  function clearSmartWaypoints() {
    routeGenerationRef.current += 1;
    smartWaypointsRef.current = [];
    for (const marker of smartMarkersRef.current) marker.remove();
    smartMarkersRef.current = [];
  }

  function leaveSmartMode({ clearWaypoints = false } = {}) {
    smartModeRef.current = false;
    setSmartDrawing(false);
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = "";
    if (clearWaypoints) clearSmartWaypoints();
  }

  function syncSmartMarkers() {
    const map = mapRef.current;
    if (!map) return;
    for (const marker of smartMarkersRef.current) marker.remove();
    smartMarkersRef.current = smartWaypointsRef.current.map((waypoint) => {
      const marker = new maplibregl.Marker({
        color: waypoint.manual ? "#f97316" : "#7c3aed",
        draggable: true,
      })
        .setLngLat(waypoint.coordinate)
        .addTo(map);
      marker.getElement().title = waypoint.manual
        ? "Off-trail waypoint — drag to move"
        : "Trail waypoint — dragging makes it off-trail";
      marker.getElement().addEventListener("click", (event) => event.stopPropagation());
      marker.on("dragend", () => {
        const dragged = smartWaypointsRef.current.find((item) => item.id === waypoint.id);
        if (!dragged) return;
        if (routingRef.current) {
          marker.setLngLat(dragged.coordinate);
          return;
        }
        const lngLat = marker.getLngLat();
        dragged.coordinate = [lngLat.lng, lngLat.lat];
        dragged.manual = true;
        void rebuildSmartRoute();
      });
      return marker;
    });
  }

  async function fetchTrailSegment(
    start: [number, number],
    end: [number, number]
  ): Promise<LineString> {
    const response = await fetch("/api/trail-route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start, end }),
    });
    const data = (await response.json().catch(() => null)) as
      | { geometry?: unknown; error?: string }
      | null;
    if (!response.ok || !data?.geometry) {
      throw new TrailSegmentError(data?.error ?? "Could not follow the trail");
    }
    return validateLineString(data.geometry);
  }

  async function fetchTrailSnap(
    point: [number, number]
  ): Promise<[number, number]> {
    const response = await fetch("/api/trail-route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ point }),
    });
    const data = (await response.json().catch(() => null)) as
      | { coordinate?: unknown; error?: string }
      | null;
    const coordinate = data?.coordinate;
    if (
      !response.ok ||
      !Array.isArray(coordinate) ||
      coordinate.length !== 2 ||
      !coordinate.every((value) => typeof value === "number" && Number.isFinite(value))
    ) {
      throw new TrailSegmentError(data?.error ?? "Could not snap to the trail");
    }
    return coordinate as [number, number];
  }

  function appendPositions(target: Position[], positions: Position[]) {
    for (const position of positions) {
      const previous = target.at(-1);
      if (!previous || previous[0] !== position[0] || previous[1] !== position[1]) {
        target.push(position);
      }
    }
  }

  async function rebuildSmartRoute() {
    if (routingRef.current) return;
    const waypoints = smartWaypointsRef.current.map((waypoint) => ({
      ...waypoint,
      coordinate: [...waypoint.coordinate] as [number, number],
    }));
    if (waypoints.length < 2) {
      syncSmartMarkers();
      return;
    }

    const generation = ++routeGenerationRef.current;
    routingRef.current = true;
    setRouting(true);
    setError(null);
    const coordinates: Position[] = [];
    let warning: string | null = null;

    try {
      for (let index = 1; index < waypoints.length; index += 1) {
        const previous = waypoints[index - 1];
        const current = waypoints[index];

        if (current.manual) {
          appendPositions(coordinates, [previous.coordinate, current.coordinate]);
          continue;
        }

        try {
          const segment = await fetchTrailSegment(previous.coordinate, current.coordinate);
          const segmentCoordinates = segment.coordinates;
          const snappedStart = segmentCoordinates[0] as [number, number];
          const snappedEnd = segmentCoordinates.at(-1) as [number, number];

          if (!previous.manual) previous.coordinate = snappedStart;
          if (previous.manual) appendPositions(coordinates, [previous.coordinate]);
          appendPositions(coordinates, segmentCoordinates);
          current.coordinate = snappedEnd;
        } catch (caught) {
          current.manual = true;
          appendPositions(coordinates, [previous.coordinate, current.coordinate]);
          warning =
            caught instanceof TrailSegmentError
              ? `${caught.message}. That section was kept straight.`
              : "Could not follow one section, so it was kept straight.";
        }
      }

      if (generation !== routeGenerationRef.current) return;
      smartWaypointsRef.current = waypoints;
      syncSmartMarkers();
      const next = validateLineString({ type: "LineString", coordinates });
      replaceDrawGeometry(next, "drawn", false);
      setMessage(
        `${waypoints.length} waypoints · ${next.coordinates.length} trail points`
      );
      setError(warning);
    } finally {
      if (generation === routeGenerationRef.current) {
        routingRef.current = false;
        setRouting(false);
      }
    }
  }

  async function addSmartWaypoint(
    clickedCoordinate: [number, number],
    forceManual: boolean
  ) {
    if (routingRef.current) return;
    const waypoint: SmartWaypoint = {
      id: crypto.randomUUID(),
      coordinate: clickedCoordinate,
      manual: forceManual,
    };
    let snapWarning: string | null = null;

    if (!forceManual) {
      routingRef.current = true;
      setRouting(true);
      setError(null);
      try {
        waypoint.coordinate = await fetchTrailSnap(clickedCoordinate);
      } catch (caught) {
        waypoint.manual = true;
        snapWarning =
          caught instanceof TrailSegmentError
            ? `${caught.message}. The point was kept exactly where you clicked.`
            : "Could not snap this point, so it was kept exactly where you clicked.";
      } finally {
        routingRef.current = false;
        setRouting(false);
      }
    }

    if (!smartModeRef.current) return;
    const previousWaypoint = smartWaypointsRef.current.at(-1);
    if (
      previousWaypoint &&
      new maplibregl.LngLat(...previousWaypoint.coordinate).distanceTo(
        new maplibregl.LngLat(...waypoint.coordinate)
      ) < 2
    ) {
      setError("Place the next waypoint a little farther along the trail");
      return;
    }
    smartWaypointsRef.current.push(waypoint);
    syncSmartMarkers();
    if (smartWaypointsRef.current.length === 1) {
      setMessage(
        waypoint.manual
          ? "Off-trail start placed. Click near a trail for the next point."
          : "Start snapped to the trail. Add another point to follow it."
      );
      setError(snapWarning);
      return;
    }
    await rebuildSmartRoute();
    if (snapWarning) setError(snapWarning);
  }

  const handleSmartMapClick = useEffectEvent(
    (coordinate: [number, number], forceManual: boolean) => {
      void addSmartWaypoint(coordinate, forceManual);
    }
  );

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

    map.on("click", (event) => {
      if (!smartModeRef.current || routingRef.current) return;
      handleSmartMapClick(
        [event.lngLat.lng, event.lngLat.lat],
        event.originalEvent.shiftKey
      );
    });

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
      clearSmartWaypoints();
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
      leaveSmartMode({ clearWaypoints: true });
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
    leaveSmartMode({ clearWaypoints: true });
    replaceDrawGeometry(null, "drawn");
    setMessage("Click points on the map, then click the last point again to finish");
    setError(null);
    draw.setMode("linestring");
  }

  function startSmartDrawing() {
    const draw = drawRef.current;
    const map = mapRef.current;
    if (!draw?.enabled || !map) return;
    leaveSmartMode({ clearWaypoints: true });
    replaceDrawGeometry(null, "drawn");
    draw.setMode("select");
    smartModeRef.current = true;
    setSmartDrawing(true);
    map.getCanvas().style.cursor = "crosshair";
    setMessage(
      "Click near trails to follow them. Shift-click places an exact off-trail point."
    );
    setError(null);
  }

  function finishSmartDrawing() {
    if (smartWaypointsRef.current.length < 2) {
      setError("Add at least two waypoints before finishing the route");
      return;
    }
    leaveSmartMode();
    setMessage(
      `${smartWaypointsRef.current.length} waypoints · route ready. Drag a waypoint to force it off-trail.`
    );
  }

  function editGeometry() {
    const draw = drawRef.current;
    if (!draw?.enabled || !geometry) return;
    if (smartWaypointsRef.current.length > 0) {
      setMessage(
        "Drag a purple waypoint to move it off-trail. Orange waypoints are already off-trail."
      );
      return;
    }
    setSource("drawn");
    draw.setMode("select");
    const feature = draw.getSnapshot().find((item) => item.geometry.type === "LineString");
    if (feature?.id !== undefined) draw.selectFeature(feature.id);
    setMessage("Drag points or midpoints to edit the line");
  }

  function clearGeometry() {
    leaveSmartMode({ clearWaypoints: true });
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
          Follow mapped trails automatically, draw manually, or import GPX/KML. Tracks
          are simplified to at most 1,000 points.
        </p>
      </div>

      <Input
        ref={fileRef}
        id="trackFile"
        name="trackFile"
        type="file"
        disabled={routing}
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
          <Button
            type="button"
            size="sm"
            disabled={routing}
            onClick={smartDrawing ? finishSmartDrawing : startSmartDrawing}
          >
            {routing ? "Following trail…" : smartDrawing ? "Finish route" : "Follow trails"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={routing}
            onClick={startDrawing}
          >
            Draw straight
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!geometry || routing}
            onClick={editGeometry}
          >
            Edit points
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={routing || (!geometry && !existingRawUrl)}
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
