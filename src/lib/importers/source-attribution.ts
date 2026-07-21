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
  osm_geofabrik: {
    label: "OpenStreetMap (Geofabrik extract)",
    attribution: "© OpenStreetMap contributors",
    licence: "ODbL 1.0",
    licenceUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    sourceUrl: "https://download.geofabrik.de/",
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
  england_coast_path: {
    label: "King Charles III England Coast Path",
    attribution: "© Natural England copyright. Contains Ordnance Survey data © Crown copyright and database right 2026.",
    licence: "Open Government Licence v3.0",
    licenceUrl: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
    sourceUrl: "https://environment.data.gov.uk/dataset/4006f956-f491-4ca9-ab01-d8c96e873165",
  },
  france_datatourisme: {
    label: "DATAtourisme",
    attribution: "Individual producer via DATAtourisme; last-update date required",
    licence: "Etalab Open Licence 2.0",
    licenceUrl: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/",
    sourceUrl: "https://www.datatourisme.fr/utiliser-les-donnees/",
  },
  sweden_naturvardsverket: {
    label: "Naturvårdsverket trails",
    attribution: "Source: Naturvårdsverket and the trail's recorded source owner",
    licence: "CC0 1.0",
    licenceUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    sourceUrl: "https://geodata.naturvardsverket.se/friluftsliv/rest/v2/",
  },
  finland_lipas: {
    label: "LIPAS",
    attribution: "Sports facilities: Lipas.fi, University of Jyväskylä, retrieval date",
    licence: "CC BY 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
    sourceUrl: "https://api.lipas.fi/v2/",
  },
  norway_kartverket_trails: {
    label: "Kartverket national route database",
    attribution: "© Kartverket; route owner/maintainer retained per record",
    licence: "NLOD 2.0",
    licenceUrl: "https://data.norge.no/nlod/no/2.0",
    sourceUrl: "https://www.kartverket.no/geodataarbeid/dok-og-temadata/turruter",
  },
  swiss_wanderland: {
    label: "Wanderland Schweiz",
    attribution: "Federal Office of Topography swisstopo; title and dataset link",
    licence: "opendata.swiss open use — source attribution required",
    licenceUrl: "https://opendata.swiss/en/terms-of-use",
    sourceUrl: "https://opendata.swiss/en/dataset/swisstlm3d-wanderwege",
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
