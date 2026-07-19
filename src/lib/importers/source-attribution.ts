export type SourceAttribution = {
  label: string;
  attribution: string;
  licence: string;
  licenceUrl: string;
  sourceUrl: string;
};

const ATTRIBUTIONS: Record<string, SourceAttribution> = {
  openbeta: {
    label: "OpenBeta",
    attribution: "OpenBeta contributors",
    licence: "CC0 1.0",
    licenceUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    sourceUrl: "https://openbeta.io/",
  },
  camptocamp: {
    label: "Camptocamp",
    attribution: "Camptocamp contributors",
    licence: "CC BY-SA 3.0",
    licenceUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
    sourceUrl: "https://www.camptocamp.org/",
  },
  osm_overpass: {
    label: "OpenStreetMap",
    attribution: "© OpenStreetMap contributors",
    licence: "ODbL 1.0",
    licenceUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    sourceUrl: "https://www.openstreetmap.org/copyright",
  },
  national_trails_england: {
    label: "National Trails England",
    attribution:
      "© Natural England copyright. Contains Ordnance Survey data © Crown copyright and database right 2026.",
    licence: "Open Government Licence v3.0",
    licenceUrl: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
    sourceUrl:
      "https://www.data.gov.uk/dataset/ac8c851c-99a0-4488-8973-6c8863529c45/national-trails-england3",
  },
  national_trails_wales: {
    label: "National Trails Wales",
    attribution:
      "Contains Natural Resources Wales information © Natural Resources Wales and Database Right. All rights reserved. Contains Ordnance Survey Data. Ordnance Survey Licence number AC0000849444. Crown Copyright and Database Right.",
    licence: "Open Government Licence v3.0",
    licenceUrl: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
    sourceUrl:
      "https://datamap.gov.wales/layers/inspire-nrw:NRW_NATIONAL_TRAIL/metadata_detail",
  },
  nature_scot_great_trails: {
    label: "Scotland's Great Trails",
    attribution: "NatureScot / Scotland's Great Trails",
    licence: "Licence supplied with the configured official distribution",
    licenceUrl: "https://www.nature.scot/copyright",
    sourceUrl:
      "https://www.nature.scot/enjoying-outdoors/routes-explore/scotlands-great-trails",
  },
};

export function sourceAttribution(source: string | null): SourceAttribution | null {
  return source ? ATTRIBUTIONS[source] ?? null : null;
}

export function sourceAttributions(sources: Iterable<string | null>): SourceAttribution[] {
  const seen = new Set<string>();
  const values: SourceAttribution[] = [];
  for (const source of sources) {
    if (!source || seen.has(source)) continue;
    seen.add(source);
    const attribution = sourceAttribution(source);
    if (attribution) values.push(attribution);
  }
  return values;
}
