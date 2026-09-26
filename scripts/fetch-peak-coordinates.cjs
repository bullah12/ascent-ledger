/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const ids = require('../docs/peak_wikidata_ids.json');
const params = new URLSearchParams({ action: 'wbgetentities', ids: Object.values(ids).join('|'), props: 'claims', format: 'json' });

async function main() {
  const response = await fetch(`https://www.wikidata.org/w/api.php?${params}`, {
    headers: { 'User-Agent': 'AscentLedgerPeakCuration/0.1 (https://github.com/bullah12/ascent-ledger)' },
  });
  if (!response.ok) throw new Error(`Wikidata HTTP ${response.status}`);
  const data = await response.json();
  const coordinates = {};
  for (const [slug, id] of Object.entries(ids)) {
    const entity = data.entities[id];
    const location = entity?.claims?.P625?.find((claim) => claim.rank !== 'deprecated')?.mainsnak?.datavalue?.value;
    const elevation = entity?.claims?.P2044?.find((claim) => claim.rank !== 'deprecated')?.mainsnak?.datavalue?.value;
    if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
      throw new Error(`${slug} (${id}) has no usable coordinates`);
    }
    coordinates[slug] = {
      wikidataId: id,
      lat: location.latitude,
      lng: location.longitude,
      elevationM: elevation?.amount && elevation.unit === 'http://www.wikidata.org/entity/Q11573' ? Math.round(Number(elevation.amount)) : null,
    };
  }
  fs.writeFileSync('docs/peak_coordinates.json', `${JSON.stringify(coordinates, null, 2)}\n`);
  console.log(`Saved coordinates for ${Object.keys(coordinates).length} peaks`);
}

main().catch((error) => { console.error(error); process.exit(1); });
