/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const peaks = require('../docs/featured_peaks.seed.json').peaks;
const compositions = require('../docs/peak_artwork_compositions.json').peaks;
const references = require('../docs/peak_artwork_references.json').peaks;

const outDir = path.join(__dirname, '..', 'public', 'peaks');
fs.mkdirSync(outDir, { recursive: true });

function escapeXml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
}

const lakes = new Set(['schiehallion', 'ben-lomond', 'stac-pollaidh', 'helvellyn', 'blencathra', 'catbells', 'haystacks', 'pavey-ark', 'cadair-idris', 'y-garn', 'fan-brycheiniog', 'mount-fuji']);
const wooded = new Set(['mount-takao', 'mount-monadnock', 'mount-washington', 'slieve-donard', 'half-dome']);

// Validate the entire catalogue before overwriting any assets.
for (const peak of peaks) {
  const art = compositions[peak.slug];
  if (!art?.skyline || !art.viewpoint || !art.features || !art.facets?.length || !references[peak.slug]?.sourceUrl) {
    throw new Error(`${peak.slug}: missing reviewed composition or photographic reference`);
  }
  for (const d of [art.skyline, ...art.facets]) {
    if (!/^M[0-9., MLQCZ-]+$/.test(d)) throw new Error(`${peak.slug}: invalid path`);
  }
}

for (const peak of peaks) {
  const art = compositions[peak.slug];
  const outline = art.skyline + ' L100 56.25 L0 56.25 Z';
  const facets = art.facets.map((d, i) => `<path d="${d}" fill="${i % 2 ? '#204637' : '#315541'}" opacity=".72"/>`).join('');
  const strata = ['strata', 'tors'].includes(art.kind)
    ? [3, 5, 7, 9].map(offset => `<path d="${art.skyline}" transform="translate(0 ${offset})" fill="none" stroke="#c7ceb1" stroke-opacity=".32" stroke-width=".24"/>`).join('')
    : '';
  const rock = ['cliff', 'ridge', 'dome'].includes(art.kind)
    ? art.facets.map(d => `<path d="${d}" fill="none" stroke="#c9d1b7" stroke-opacity=".19" stroke-width=".16"/>`).join('')
    : '';
  const water = lakes.has(peak.slug)
    ? `<path d="M0 49 Q19 47 35 48 Q61 46 79 48 L100 47 L100 56.25 L0 56.25Z" fill="#8ba79b"/>
       <path d="M12 51 H39 M52 50 H81 M29 53 H68 M74 54 H94" stroke="#e0e5d1" stroke-opacity=".55" stroke-width=".18"/>`
    : '';
  const forest = wooded.has(peak.slug)
    ? Array.from({ length: 36 }, (_, i) => {
        const x = i * 3;
        const y = 48 + Math.sin(i * 0.8) * 1.3;
        const h = 1.1 + (i % 4) * .3;
        return `<path d="M${x} ${y-h} l-1 ${h+1} h2Z" fill="#183d30"/>`;
      }).join('')
    : '';
  const snow = peak.slug === 'mount-fuji'
    ? '<path d="M38 29 L47 21 H53 L63 32 L55 29 L54 33 L50 27 L46 30 L45 27Z" fill="#eeeadd" opacity=".9"/>'
    : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675" role="img" aria-labelledby="title desc">
<title id="title">${escapeXml(peak.name)} — illustrated landscape</title>
<desc id="desc">${escapeXml(art.viewpoint)}. ${escapeXml(art.features)} Original simplified illustration informed by landscape photographs; not a measured panorama or route map.</desc>
<metadata>Composition reference: ${escapeXml(references[peak.slug].sourceUrl)}</metadata>
<rect width="1200" height="675" fill="#f1ebdf"/>
<g transform="scale(12)">
<g fill="none" stroke="#c7bdab" stroke-opacity=".36" stroke-width=".15">
<path d="M-8 8 C12 -1 25 12 40 6 S73 0 105 9"/><path d="M-8 10 C12 1 25 14 40 8 S73 2 105 11"/>
<path d="M-8 12 C12 3 25 16 40 10 S73 4 105 13"/>
</g>
<circle cx="84" cy="15" r="5.8" fill="#d6bd91" opacity=".42"/>
<path d="M0 46 Q14 38 28 43 T56 42 T81 42 T100 40 V56.25 H0Z" fill="#b6c4ad"/>
<defs><clipPath id="mountain"><path d="${outline}"/></clipPath></defs>
<path d="${outline}" fill="#63806a"/>
<g clip-path="url(#mountain)">
${facets}${strata}${rock}${snow}
<path d="M-5 48 Q21 42 40 48 T77 47 T108 45 V60 H-5Z" fill="#47674e" opacity=".48"/>
</g>
${water}${forest}
<path d="M0 53 Q15 49 28 53 T60 55 Q82 50 100 53 V56.25 H0Z" fill="#183d30"/>
<path d="M0 54 Q16 51 28 54 M75 54 Q87 52 100 54" fill="none" stroke="#d6d9bc" stroke-opacity=".24" stroke-width=".18"/>
</g>
</svg>\n`;
  fs.writeFileSync(path.join(outDir, `${peak.slug}.svg`), svg);
}
console.log(`Rendered ${peaks.length} individually composed mountain landscapes`);
