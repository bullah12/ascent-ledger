"use client";

import { useEffect, useRef } from "react";
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

const CLIMBS_SOURCE = "climbs";

export function MapView({ climbs }: { climbs: ClimbFeature[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

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

      for (const layer of ["clusters", "climb-points"]) {
        map.on("mouseenter", layer, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layer, () => {
          map.getCanvas().style.cursor = "";
        });
      }

      if (climbs.length > 0) {
        const bounds = new maplibregl.LngLatBounds();
        for (const climb of climbs) bounds.extend([climb.lng, climb.lat]);
        map.fitBounds(bounds, { padding: 60, maxZoom: 12 });
      }
    });

    return () => map.remove();
  }, [climbs]);

  return <div ref={containerRef} className="h-[70vh] w-full rounded-lg border" />;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
