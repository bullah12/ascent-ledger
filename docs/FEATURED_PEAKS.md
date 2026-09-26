# Featured peaks and routes

`featured_peaks.seed.json` is the editable shortlist for the public peak browser.
It currently contains 50 peaks: 40 in the UK, four elsewhere in Europe, three
in Asia, and three in the Americas. Four flagship peaks have a second route
variant, for 54 route overviews in total. The list deliberately spans popular
walks, shorter approaches, strenuous mountain days and graded scrambles.

Run `npm run db:seed:featured` after `prisma migrate deploy`. The seed uses
stable external IDs and upserts rows, so rerunning it does not create duplicate
peaks or routes. It does not edit routes from external importers or user logs.

These entries identify named approaches and give short editorial summaries.
The difficulty text is a broad route label. It is not a substitute for a guide,
current access information, weather, or a map. Distances, times, ascent figures
and route geometry are left blank unless independently checked. Entries with a
`source_url` link to a route reference; the rest are editorial selections awaiting
an external reference. The route detail page labels all featured entries as
overviews and asks visitors to check current conditions.

## Artwork

Each SVG in `public/peaks/` traces an east-to-west elevation cross-section
through a summit. The summit coordinates and Wikidata IDs are recorded in
`peak_coordinates.json` and `peak_wikidata_ids.json`. The 81-point terrain samples
in `peak_profiles.json` came from NASA SRTM 90 m data via the public
[OpenTopoData SRTM endpoint](https://www.opentopodata.org/datasets/srtm/).
`node scripts/render-peak-artwork.cjs` regenerates the SVGs locally without
making network requests. The illustrations are stylised terrain profiles. They
are not a skyline from a particular viewpoint or navigational route maps.

If adding more peaks, check ambiguous Wikidata names by location before using
`node scripts/fetch-peak-coordinates.cjs`. The public OpenTopoData instance
limits usage to one request per second; `scripts/fetch-peak-profiles.cjs`
respects this limit and resumes from the checked-in profiles file.
