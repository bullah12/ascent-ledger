import type { LineString, Position } from "geojson";
import { geodesicLengthM } from "./geometry";
import type { ExternalRoute } from "./types";

/** Naismith's rule: one hour per 5 km plus one hour per 600 m climbed. */
export function estimateHikingDurationMinutes(distanceM: number, ascentM: number) {
  if (distanceM <= 0 || ascentM < 0) return null;
  return Math.max(1, Math.round(distanceM / 5_000 * 60 + ascentM / 600 * 60));
}

export function withEstimatedHikingDuration(route: ExternalRoute): ExternalRoute {
  if (route.discipline !== "hiking" || route.estimatedDurationMins) return route;
  const distance = route.lengthM ?? route.calculatedLengthM ?? geodesicLengthM(route.pathGeojson);
  const ascent = route.ascentM ?? route.calculatedAscentM ?? 0;
  const calculatedDurationMins = distance ? estimateHikingDurationMinutes(distance, ascent) : null;
  return calculatedDurationMins ? { ...route, calculatedDurationMins } : route;
}

export type ElevationSampler = {
  /** Batch lookup backed by a local/open DEM tile cache; never one HTTP call per point. */
  sample(points: Position[]): Promise<Array<number | null>>;
};

function sampleLine(line: LineString, maximumPoints = 2_000) {
  if (line.coordinates.length <= maximumPoints) return line.coordinates;
  const step = (line.coordinates.length - 1) / (maximumPoints - 1);
  return Array.from({ length: maximumPoints }, (_, index) => line.coordinates[Math.round(index * step)]);
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Batch/sample a local Copernicus GLO-30-compatible DEM. A three-sample median
 * removes isolated spikes; gains under three metres are treated as DEM noise.
 */
export async function calculateDemAscent(line: LineString, sampler: ElevationSampler) {
  const elevations = await sampler.sample(sampleLine(line));
  const valid = elevations.flatMap((value) => value === null || !Number.isFinite(value) ? [] : [value]);
  if (valid.length < 2 || valid.length < elevations.length * 0.8) return null;
  const smoothed = valid.map((_value, index) => median(valid.slice(Math.max(0, index - 1), Math.min(valid.length, index + 2))));
  let ascent = 0;
  for (let index = 1; index < smoothed.length; index++) {
    const gain = smoothed[index] - smoothed[index - 1];
    if (gain >= 3) ascent += gain;
  }
  return Math.round(ascent);
}

export async function withDemElevation(route: ExternalRoute, sampler: ElevationSampler): Promise<ExternalRoute> {
  if (!route.pathGeojson || route.ascentM !== null && route.ascentM !== undefined) return route;
  const calculatedAscentM = await calculateDemAscent(route.pathGeojson, sampler);
  return calculatedAscentM === null ? route : { ...route, calculatedAscentM };
}
