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

Each SVG in `public/peaks/` is an individually composed landscape illustration.
`peak_artwork_references.json` records the selected photographic references;
`peak_artwork_compositions.json` records the viewpoint, identifying features,
skyline and face shapes. The paper, green palette and contour motif are shared;
the mountain geometry is individual. Broad tops must remain broad, and low
moors must not be stretched into alpine peaks. These are simplified editorial
interpretations, not photograph tracings, measured panoramas or route maps.

`node scripts/render-peak-artwork.cjs` regenerates all 50 SVGs offline, validating
that every peak has a composition and reference before writing. Existing asset
paths are retained, so no database reseed is necessary. The shared image component
fits the entire artwork into cards, square thumbnails and banners without cropping
away the shoulders. Reference photographs are not redistributed or hotlinked in
the application. See [the catalogue review](PEAK_ARTWORK_REVIEW.md) for all 54
route entries, the chosen views and the distinction between a mountain portrait
and a route-specific view.

The old east–west elevation slices remain in `peak_profiles.json` as historical
terrain data. They are no longer used to generate the artwork: a summit transect
does not describe the visible skyline, and independent height normalisation
exaggerated rounded and flat-topped mountains.

If adding more peaks, check ambiguous Wikidata names by location before using
`node scripts/fetch-peak-coordinates.cjs`. The public OpenTopoData instance
limits usage to one request per second; `scripts/fetch-peak-profiles.cjs`
respects this limit and resumes from the checked-in profiles file.
