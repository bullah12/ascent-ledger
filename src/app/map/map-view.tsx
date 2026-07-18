"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

export type ClimbFeature = {
  lng: number;
  lat: number;
  name: string;
  gradeRaw: string;
  date: string;
  discipline: string;
  areaName: string | null;
};

export type SuggestedFeature = {
  lng: number;
  lat: number;
  name: string;
  gradeRaw: string | null;
  areaName: string | null;
  category: string; // discipline key, used by the per-category toggle
  categoryLabel: string;
  why: string;
};

export type GpxTrack = {
  url: string;
  name: string;
};

const CLIMBS_SOURCE = "climbs";
const SUGGESTED_SOURCE = "suggested";
const SUGGESTED_COLOR = "#d97706"; // amber — distinct from the teal climbs
const TRACK_COLOR = "#7c3aed"; // violet — GPX tracks
const MAX_TRACKS = 20;

// Minimal GPX parse: every <trkpt>/<rtept> lat/lon in document order.
function parseGpx(xml: string): [number, number][] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const points: [number, number][] = [];
  for (const pt of doc.querySelectorAll("trkpt, rtept")) {
    const lat = Number(pt.getAttribute("lat"));
    const lon = Number(pt.getAttribute("lon"));
    if (Number.isFinite(lat) && Number.isFinite(lon)) points.push([lon, lat]);
  }
  return points;
}

function suggestedFilter(enabled: string[]): maplibregl.FilterSpecification {
  return ["in", ["get", "category"], ["literal", enabled]];
}

export function MapView({
  climbs,
  suggested,
  tracks = [],
}: {
  climbs: ClimbFeature[];
  suggested: SuggestedFeature[];
  tracks?: GpxTrack[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  const categories = [...new Map(suggested.map((s) => [s.category, s.categoryLabel]))];
  const [enabled, setEnabled] = useState<string[]>(() =>
    categories.map(([key]) => key)
  );
  // Mirrors `enabled` for the map's async load callback (a ref so the map
  // isn't torn down and rebuilt on every toggle).
  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      // Raster OSM tiles — free, no API key; attribution is required.
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
      center: [-3.5, 54.5], // UK-ish default when there's nothing to fit
      zoom: 4.5,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      map.addSource(CLIMBS_SOURCE, {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: climbs.map((climb) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [climb.lng, climb.lat] },
            properties: {
              name: climb.name,
              gradeRaw: climb.gradeRaw,
              date: climb.date,
              discipline: climb.discipline,
              areaName: climb.areaName ?? "",
            },
          })),
        },
        cluster: true,
        clusterMaxZoom: 11,
        clusterRadius: 50,
      });

      map.addLayer({
        id: "clusters",
        type: "circle",
        source: CLIMBS_SOURCE,
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#0f766e",
          "circle-opacity": 0.85,
          "circle-radius": ["step", ["get", "point_count"], 16, 10, 22, 50, 28],
        },
      });

      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: CLIMBS_SOURCE,
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-size": 12,
        },
        paint: { "text-color": "#ffffff" },
      });

      map.addLayer({
        id: "climb-points",
        type: "circle",
        source: CLIMBS_SOURCE,
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": "#0f766e",
          "circle-radius": 7,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });

      // Suggested routes: separate unclustered source, distinct amber
      // markers, filterable per BMG category via the checkboxes.
      map.addSource(SUGGESTED_SOURCE, {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: suggested.map((s) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [s.lng, s.lat] },
            properties: {
              name: s.name,
              gradeRaw: s.gradeRaw ?? "",
              areaName: s.areaName ?? "",
              category: s.category,
              categoryLabel: s.categoryLabel,
              why: s.why,
            },
          })),
        },
      });

      map.addLayer({
        id: "suggested-points",
        type: "circle",
        source: SUGGESTED_SOURCE,
        filter: suggestedFilter(enabledRef.current),
        paint: {
          "circle-color": SUGGESTED_COLOR,
          "circle-radius": 7,
          "circle-opacity": 0.9,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });

      map.on("click", "suggested-points", (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const props = feature.properties as Record<string, string>;
        const coordinates = (
          feature.geometry as GeoJSON.Point
        ).coordinates.slice() as [number, number];

        const lines = [
          `<strong>${escapeHtml(props.name)}</strong> <em>(suggested · ${escapeHtml(props.categoryLabel)})</em>`,
          escapeHtml([props.gradeRaw, props.areaName].filter(Boolean).join(" · ")),
          escapeHtml(props.why),
        ].filter(Boolean);

        new maplibregl.Popup({ offset: 12 })
          .setLngLat(coordinates)
          .setHTML(lines.join("<br/>"))
          .addTo(map);
      });

      // Clicking a cluster zooms into it.
      map.on("click", "clusters", async (e) => {
        const feature = map.queryRenderedFeatures(e.point, {
          layers: ["clusters"],
        })[0];
        const clusterId = feature.properties?.cluster_id;
        const source = map.getSource(CLIMBS_SOURCE) as maplibregl.GeoJSONSource;
        const zoom = await source.getClusterExpansionZoom(clusterId);
        map.easeTo({
          center: (feature.geometry as GeoJSON.Point).coordinates as [number, number],
          zoom,
        });
      });

      // Clicking a climb shows its details.
      map.on("click", "climb-points", (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const props = feature.properties as Record<string, string>;
        const coordinates = (
          feature.geometry as GeoJSON.Point
        ).coordinates.slice() as [number, number];

        const lines = [
          `<strong>${escapeHtml(props.name)}</strong>`,
          escapeHtml([props.gradeRaw, props.discipline].filter(Boolean).join(" · ")),
          escapeHtml([props.areaName, props.date].filter(Boolean).join(" · ")),
        ].filter(Boolean);

        new maplibregl.Popup({ offset: 12 })
          .setLngLat(coordinates)
          .setHTML(lines.join("<br/>"))
          .addTo(map);
      });

      for (const layer of ["clusters", "climb-points", "suggested-points"]) {
        map.on("mouseenter", layer, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layer, () => {
          map.getCanvas().style.cursor = "";
        });
      }

      // GPX tracks load lazily after the map is up; a failed fetch just
      // means that track doesn't draw.
      void (async () => {
        for (const track of tracks.slice(0, MAX_TRACKS)) {
          try {
            const response = await fetch(track.url);
            if (!response.ok) continue;
            const points = parseGpx(await response.text());
            if (points.length < 2 || mapRef.current !== map) continue;
            const sourceId = `gpx-${track.url}`;
            if (map.getSource(sourceId)) continue;
            map.addSource(sourceId, {
              type: "geojson",
              data: {
                type: "Feature",
                geometry: { type: "LineString", coordinates: points },
                properties: { name: track.name },
              },
            });
            map.addLayer({
              id: sourceId,
              type: "line",
              source: sourceId,
              paint: {
                "line-color": TRACK_COLOR,
                "line-width": 3,
                "line-opacity": 0.8,
              },
            });
          } catch {
            // Unreachable track file — skip it.
          }
        }
      })();

      if (climbs.length > 0 || suggested.length > 0) {
        const bounds = new maplibregl.LngLatBounds();
        for (const climb of climbs) bounds.extend([climb.lng, climb.lat]);
        for (const s of suggested) bounds.extend([s.lng, s.lat]);
        map.fitBounds(bounds, { padding: 60, maxZoom: 12 });
      }
    });

    return () => {
      mapRef.current = null;
      map.remove();
    };
  }, [climbs, suggested, tracks]);

  // Per-category visibility for suggested markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("suggested-points")) return;
    map.setFilter("suggested-points", suggestedFilter(enabled));
  }, [enabled]);

  function toggle(category: string) {
    setEnabled((current) =>
      current.includes(category)
        ? current.filter((c) => c !== category)
        : [...current, category]
    );
  }

  return (
    <div className="grid gap-2">
      {(categories.length > 0 || tracks.length > 0) && (
        <div className="flex flex-wrap items-center gap-4 text-sm">
          {tracks.length > 0 && (
            <span className="text-muted-foreground">
              <span
                className="mr-1 inline-block h-1 w-4 rounded align-middle"
                style={{ backgroundColor: TRACK_COLOR }}
              />
              GPX tracks
            </span>
          )}
          {categories.length > 0 && (
            <>
              <span className="text-muted-foreground">
                <span
                  className="mr-1 inline-block size-2.5 rounded-full align-middle"
                  style={{ backgroundColor: SUGGESTED_COLOR }}
                />
                Suggested routes:
              </span>
              {categories.map(([key, label]) => (
                <label key={key} className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={enabled.includes(key)}
                    onChange={() => toggle(key)}
                  />
                  {label}
                </label>
              ))}
            </>
          )}
        </div>
      )}
      <div ref={containerRef} className="h-[70vh] w-full rounded-lg border" />
    </div>
  );
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
