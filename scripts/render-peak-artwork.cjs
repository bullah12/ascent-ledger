/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const peaks = require('../docs/featured_peaks.seed.json').peaks;
const profiles = require('../docs/peak_profiles.json');

const outDir = path.join(__dirname, '..', 'public', 'peaks');
fs.mkdirSync(outDir, { recursive: true });

function escapeXml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
}

function ridgePath(points, transform = (y) => y) {
  return `M 0 ${transform(points[0]).toFixed(1)} ` + points.map((y, i) => `L ${(i * 1200 / (points.length - 1)).toFixed(1)} ${transform(y).toFixed(1)}`).join(' ') + ' L 1200 675 L 0 675 Z';
}

for (const peak of peaks) {
  const elevations = profiles[peak.slug]?.elevations;
  if (!elevations || elevations.length !== 81) throw new Error(`${peak.slug}: missing 81-point profile`);
  const smoothed = elevations.map((value, i) => (value * 2 + (elevations[i - 1] ?? value) + (elevations[i + 1] ?? value)) / 4);
  const floor = Math.min(...smoothed) - 65;
  const ceiling = Math.max(...smoothed) + 45;
  const points = smoothed.map((value) => 550 - (value - floor) / (ceiling - floor) * 420);
  const front = ridgePath(points);
  const middle = ridgePath(points, (y) => y * 0.65 + 225);
  const distant = ridgePath(points, (y) => y * 0.42 + 350);
  const contours = [45, 95, 145].map((offset) => `<path d="${ridgePath(points, (y) => y + offset)}" fill="none" stroke="#d8e2d2" stroke-opacity=".20" stroke-width="3"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675" role="img" aria-labelledby="title desc">
<title id="title">${escapeXml(peak.name)} terrain profile</title>
<desc id="desc">Stylised east to west elevation cross-section through ${escapeXml(peak.name)}, based on NASA SRTM 90 metre terrain data via OpenTopoData. It is an illustration, not a route map or navigational aid.</desc>
<defs><linearGradient id="paper" x2="0" y2="1"><stop stop-color="#f6f0e5"/><stop offset="1" stop-color="#e8e2d3"/></linearGradient><clipPath id="ridge"><path d="${front}"/></clipPath></defs>
<rect width="1200" height="675" fill="url(#paper)"/>
<g fill="none" stroke="#c9c1af" stroke-opacity=".48" stroke-width="2">
<path d="M-80 72 C135 -35 301 143 468 59 S801 -27 1260 80"/><path d="M-80 100 C135 -7 301 171 468 87 S801 1 1260 108"/>
<path d="M-80 128 C135 21 301 199 468 115 S801 29 1260 136"/><path d="M-80 156 C135 49 301 227 468 143 S801 57 1260 164"/>
</g>
<circle cx="995" cy="185" r="75" fill="#ddc9a4" fill-opacity=".42"/>
<path d="${distant}" fill="#a9bea9"/><path d="${middle}" fill="#668b73"/>
<path d="${front}" fill="#173b2d"/>
<g clip-path="url(#ridge)">${contours}<path d="M0 618 C230 570 405 650 640 588 S1020 610 1200 560" fill="none" stroke="#c5d7c2" stroke-opacity=".18" stroke-width="4"/></g>
</svg>`;
  fs.writeFileSync(path.join(outDir, `${peak.slug}.svg`), svg);
}

console.log(`Rendered ${peaks.length} terrain-profile illustrations`);
