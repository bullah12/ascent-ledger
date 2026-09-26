/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const coordinates = require('../docs/peak_coordinates.json');
const profiles = fs.existsSync('docs/peak_profiles.json') ? require('../docs/peak_profiles.json') : {};

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  for (const [slug, peak] of Object.entries(coordinates)) {
    if (profiles[slug]?.elevations?.length === 81) continue;
    const spanKm = peak.elevationM && peak.elevationM > 2500 ? 15 : peak.elevationM && peak.elevationM < 700 ? 4 : 7;
    const longitudeSpan = spanKm / (111.32 * Math.cos(peak.lat * Math.PI / 180));
    const left = `${peak.lat.toFixed(6)},${(peak.lng - longitudeSpan).toFixed(6)}`;
    const right = `${peak.lat.toFixed(6)},${(peak.lng + longitudeSpan).toFixed(6)}`;
    const params = new URLSearchParams({ locations: `${left}|${right}`, samples: '81', interpolation: 'bilinear' });
    let data;
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(`https://api.opentopodata.org/v1/srtm90m?${params}`);
      if (response.ok) { data = await response.json(); break; }
      if (attempt === 2) throw new Error(`${slug}: HTTP ${response.status}`);
      await pause(3000);
    }
    const elevations = data?.results?.map((result) => result.elevation);
    if (data?.status !== 'OK' || elevations?.length !== 81 || elevations.some((height) => !Number.isFinite(height))) {
      throw new Error(`${slug}: incomplete elevation profile`);
    }
    profiles[slug] = { dataset: 'NASA SRTM 90m via OpenTopoData', orientation: 'east-west', spanKm, elevations };
    fs.writeFileSync('docs/peak_profiles.json', `${JSON.stringify(profiles, null, 2)}\n`);
    console.log(`${Object.keys(profiles).length}/50 ${slug}`);
    await pause(1200);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
