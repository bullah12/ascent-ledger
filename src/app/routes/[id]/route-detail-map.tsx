"use client";

import { useEffect, useRef } from "react";
import type { LineString } from "geojson";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

export function RouteDetailMap({
  geometry,
  point,
}: {
  geometry: LineString | null;
  point: { lat: number; lng: number } | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const coordinates = geometry?.coordinates ?? (point ? [[point.lng, point.lat]] : []);
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
        layers: [{ id: "osm", type: "raster", source: "osm", paint: { "raster-saturation": -0.72, "raster-opacity": 0.76 } }],
      },
      center: point ? [point.lng, point.lat] : (coordinates[0] as [number, number] | undefined) ?? [-3.5, 54.5],
      zoom: point || coordinates.length ? 12 : 4.5,
      interactive: true,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      if (geometry) {
        map.addSource("route-detail", { type: "geojson", data: { type: "Feature", properties: {}, geometry } });
        map.addLayer({ id: "route-detail-line", type: "line", source: "route-detail", paint: { "line-color": "#a4512d", "line-width": 4, "line-dasharray": [2, 2] } });
      }
      if (coordinates.length) {
        const [startLng, startLat] = coordinates[0];
        new maplibregl.Marker({ color: "#28794f", scale: 0.75 }).setLngLat([startLng, startLat]).addTo(map);
        if (coordinates.length > 1) {
          const [endLng, endLat] = coordinates.at(-1)!;
          new maplibregl.Marker({ color: "#a4512d", scale: 0.75 }).setLngLat([endLng, endLat]).addTo(map);
        }
        const bounds = new maplibregl.LngLatBounds();
        coordinates.forEach(([lng, lat]) => bounds.extend([lng, lat]));
        if (coordinates.length > 1) map.fitBounds(bounds, { padding: 50, maxZoom: 14 });
      }
    });
    return () => map.remove();
  }, [geometry, point]);

  if (!geometry && !point) {
    return <div className="topographic-placeholder flex h-[240px] items-end p-4"><span className="rounded bg-background/90 px-3 py-1 font-mono text-[10px] uppercase text-muted-foreground">Route geometry not recorded</span></div>;
  }
  return <div ref={containerRef} className="h-[240px] w-full" aria-label="Route map" />;
}
