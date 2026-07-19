export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const radians = Math.PI / 180;
  const deltaLat = (b.lat - a.lat) * radians;
  const deltaLng = (b.lng - a.lng) * radians;
  const value =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(a.lat * radians) *
      Math.cos(b.lat * radians) *
      Math.sin(deltaLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(value));
}

export function proximityScore(value: number, target: number, falloff: number): number {
  if (falloff <= 0) return value === target ? 1 : 0;
  return clamp01(1 - Math.abs(value - target) / falloff);
}

export function ratingScore(rating: number | null, missing = 0.5): number {
  return rating === null ? missing : clamp01((rating - 1) / 4);
}

export function recencyWeight(
  date: Date,
  now: Date,
  halfLifeDays = 365
): number {
  const ageDays = Math.max(0, (now.getTime() - date.getTime()) / 86_400_000);
  return 0.5 ** (ageDays / halfLifeDays);
}

export function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}
