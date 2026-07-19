"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { LineString } from "geojson";
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

export type StoredPath = {
  id: string;
  geometry: LineString;
  name: string;
  kind: "climb" | "route";
  source: string | null;
};

const CLIMBS_SOURCE = "climbs";
const SUGGESTED_SOURCE = "suggested";
const PATHS_SOURCE = "stored-paths";
const SUGGESTED_COLOR = "#d97706"; // amber — distinct from the teal climbs
const CLIMB_PATH_COLOR = "#7c3aed"; // violet — personal tracks
const ROUTE_PATH_COLOR = "#2563eb"; // blue — canonical route geometry

function suggestedFilter(enabled: string[]): maplibregl.FilterSpecification {
  return ["in", ["get", "category"], ["literal", enabled]];
}

export function MapView({
  climbs,
  suggested,
  paths = [],
}: {
  climbs: ClimbFeature[];
  suggested: SuggestedFeature[];
  paths?: StoredPath[];
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

      map.addSource(PATHS_SOURCE, {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: paths.map((path) => ({
            id: path.id,
            type: "Feature",
            geometry: path.geometry,
            properties: {
              name: path.name,
              kind: path.kind,
              source: path.source ?? "",
            },
          })),
        },
      });

      map.addLayer({
        id: "route-paths",
        type: "line",
        source: PATHS_SOURCE,
        filter: ["==", ["get", "kind"], "route"],
        paint: {
          "line-color": ROUTE_PATH_COLOR,
          "line-width": 3,
          "line-opacity": 0.65,
        },
      });

      map.addLayer({
        id: "climb-paths",
        type: "line",
        source: PATHS_SOURCE,
        filter: ["==", ["get", "kind"], "climb"],
        paint: {
          "line-color": CLIMB_PATH_COLOR,
          "line-width": 4,
          "line-opacity": 0.85,
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

      const showPathPopup = (e: maplibregl.MapLayerMouseEvent) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const props = feature.properties as Record<string, string>;
        new maplibregl.Popup({ offset: 8 })
          .setLngLat(e.lngLat)
          .setHTML(
            [
              `<strong>${escapeHtml(props.name)}</strong>`,
              escapeHtml(
                props.kind === "climb"
                  ? `Personal track${props.source ? ` · ${props.source}` : ""}`
                  : `Canonical route${props.source ? ` · ${props.source}` : ""}`
              ),
            ].join("<br/>")
          )
          .addTo(map);
      };
      map.on("click", "route-paths", showPathPopup);
      map.on("click", "climb-paths", showPathPopup);

      for (const layer of [
        "clusters",
        "climb-points",
        "suggested-points",
        "route-paths",
        "climb-paths",
      ]) {
        map.on("mouseenter", layer, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layer, () => {
          map.getCanvas().style.cursor = "";
        });
      }

      if (climbs.length > 0 || suggested.length > 0 || paths.length > 0) {
        const bounds = new maplibregl.LngLatBounds();
        for (const climb of climbs) bounds.extend([climb.lng, climb.lat]);
        for (const s of suggested) bounds.extend([s.lng, s.lat]);
        for (const path of paths) {
          for (const [lng, lat] of path.geometry.coordinates) bounds.extend([lng, lat]);
        }
        map.fitBounds(bounds, { padding: 60, maxZoom: 12 });
      }
    });

    return () => {
      mapRef.current = null;
      map.remove();
    };
  }, [climbs, suggested, paths]);

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
      {(categories.length > 0 || paths.length > 0) && (
        <div className="flex flex-wrap items-center gap-4 text-sm">
          {paths.some((path) => path.kind === "climb") && (
            <span className="text-muted-foreground">
              <span className="mr-1 inline-block h-1 w-4 rounded align-middle" style={{ backgroundColor: CLIMB_PATH_COLOR }} />
              Personal tracks
            </span>
          )}
          {paths.some((path) => path.kind === "route") && (
            <span className="text-muted-foreground">
              <span className="mr-1 inline-block h-1 w-4 rounded align-middle" style={{ backgroundColor: ROUTE_PATH_COLOR }} />
              Route geometry
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
