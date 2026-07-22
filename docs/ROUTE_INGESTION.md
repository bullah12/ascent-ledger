# UK and Europe route ingestion

Ascent Ledger imports candidate records only from open data and source APIs whose reuse terms permit redistribution. It never scrapes proprietary guidebooks or route sites. `Route` is the canonical object, but only imported routes with `publicationState=approved` and `verificationStatus=verified` are public. Every imported representation—including rejected records—is retained in `RouteSourceRecord` with its decision, original ID, URL, metadata, geometry, licence, attribution, timestamps, fingerprint, checkpoint and active/stale lifecycle.

Private user geometry is stored separately in `CustomTrail`, always with one `ownerId`. It is never copied into `Route`, source records, public reviews/tags/ticks, the sitemap, or recommendation candidates.

## Publication policy

`src/lib/routes/quality-policy.ts` is the single versioned policy (`route-quality-v1`). A route is public only when all three shared query predicates are true: its origin is `imported`, publication state is `approved`, and verification status is `verified`.

The policy approves:

- a named, supported, usable line of at least 100 m from an explicitly allowlisted official agency dataset; or
- an OSM `relation/*` with `type=route`, `route=hiking|foot`, usable non-fragmented geometry of at least 500 m, a score of at least 70, and convincing authority: a recognised `iwn|nwn|rwn|lwn` network plus at least one identity/authority signal, or at least three such signals without a recognised network. Signals are `ref`, operator, `osmc:symbol`, official website, and Wikidata/Wikipedia identity.

Standalone OSM ways, unsupported activities, unnamed records, unusable/clipped geometry, implausibly short routes, and residential/commute-looking records without strong authority are rejected. Plausible OSM relations below the authority threshold are quarantined. Community catalogues are pending review unless a human-curated dataset such as the versioned starter seed explicitly verifies them. A name never qualifies a route by itself.

## Coverage and terms

| Source | Coverage / disciplines | Terms stored per record | State |
| --- | --- | --- | --- |
| OpenStreetMap via Geofabrik | Every registered European country; hiking/foot, via ferrata, emerging climbing routes | ODbL 1.0; `© OpenStreetMap contributors` | Primary baseline, enabled |
| OSM Overpass | Bounded UK/Alps manual fallback | ODbL 1.0 | Manual only |
| Camptocamp API | Europe; rock, alpine, ski touring, ice and mixed/winter routes | Route content CC BY-SA 3.0; images are not imported because media licences vary | Enabled |
| OpenBeta API | Configured European area roots; rock routes | CC0 1.0 / public-domain dedication | Enabled |
| National Trails England | England hiking | OGL v3.0; Natural England and OS attribution shown in the app | Enabled |
| National Trails Wales | Wales hiking | OGL v3.0 with NRW/OS attribution | Enabled |
| King Charles III England Coast Path route line | Approved England stretches only, never coastal-margin polygons | OGL v3.0; Natural England/OS attribution | Enabled |
| Scotland's Great Trails | Scotland hiking | Licence supplied with the confirmed external distribution; NatureScot/OS attribution | Disabled until both URL and licence are configured |
| DATAtourisme TOUR | France hiking, mountaineering, via ferrata and climbing itineraries; cycling excluded | Etalab Open Licence 2.0; `hasBeenCreatedBy` and `lastUpdate` retained and displayed | Adapter enabled when an official `/tour` or daily TOUR URL is configured |
| Naturvårdsverket `Leder` | Sweden named walking/hiking routes | CC0; source owner retained | Enabled |
| LIPAS API v2 distribution | Finland named outdoor line routes | CC BY 4.0; `Lipas.fi, University of Jyväskylä, retrieval date` | Adapter enabled when an official GeoJSON API/export URL is configured |
| Kartverket national route database | Norway foot/hiking and ski routes; cycling excluded | NLOD 2.0; owner/maintainer retained | Adapter enabled when a Geonorge official GeoJSON download URL is configured |
| Wanderland Schweiz | Switzerland/Liechtenstein named routes | opendata.swiss open-use terms; swisstopo source/title/link attribution | Adapter enabled when the named-route GeoJSON URL is configured; swissTLM3D is enrichment, not a canonical catalogue |

The OSM registry is in `src/lib/importers/geofabrik-registry.ts`. France and Germany are already divided into Geofabrik subregions so their country PBFs cannot exceed the scheduled runner's 4 GiB cap; Italy contains San Marino/Vatican City and their OSM administrative boundaries, while Russia and the Channel Islands have explicit shards. The importer refuses files over `GEOFABRIK_MAX_DOWNLOAD_MB`, uses an identifiable user-agent, retries 429/5xx responses with backoff, streams into a `.part` file, atomically renames it, persists ETags, verifies Geofabrik's MD5 sidecar when available, calculates a local checksum, and deletes failed partial downloads. The whole-Europe PBF is not registered or downloaded.

### Permission-gated or rejected

- Northern Ireland GreenspaceNI/off-road-trails remains disabled. The referenced ArcGIS item and mixed contributor layers do not expose sufficiently clear database-wide commercial reuse terms. NI baseline coverage comes from the Ireland/Northern Ireland OSM extract.
- NatureScot remains disabled until an explicitly public external distribution URL and its exact licence are supplied. An internal-only ArcGIS item is not acceptable.
- ERA E-paths remains permission-gated until database-wide reuse permission is published or granted in writing.
- UKClimbing/UKHillwalking, Rockfax, AllTrails, Komoot, Wikiloc, Outdooractive, Strava, 8a.nu and proprietary guidebook sites are rejected for bulk ingestion.
- Waymarked Trails is only a QA/deep link over OSM. openrouteservice remains interactive routing/snapping, not a named-route catalogue.
- The official OpenBeta Parquet export was investigated. The current adapter keeps the official GraphQL traversal because this application has no declared streaming Parquet reader; the checkpoint contract allows a future Parquet adapter without schema changes.

## OSM extraction and geometry

PBF decoding uses the declared BSD-licensed `pbf` Node package and the OSM-binary schema in a repository-owned streaming reader—no system `osmium` binary. The extractor makes three bounded passes:

1. collect relevant route relations and direct climbing/ferrata ways as source candidates (the policy rejects standalone OSM ways before canonical publication);
2. collect only their member ways and node references;
3. collect only referenced node coordinates.

Relation order and roles are retained. Empty, `main`, `forward` and `backward` members form the legacy canonical line; alternatives, excursions, child relations and disconnected sections remain in structured segments. Missing members and extract-boundary clipping are explicit. The app warns on incomplete/clipped geometry. Geodesic distance is calculated only when no source distance is present.

OSM country comes from an in-extract point-in-polygon join against `boundary=administrative`, `admin_level=2` relations, with the spatially clipped Geofabrik shard as a fallback—never `addr:country`. This distinguishes Northern Ireland from Ireland inside their combined extract. Border clipping is flagged.

OSM SAC normalization uses the hardest relevant member-way value:

- `strolling`, `hiking` → T1
- `mountain_hiking` → T2
- `demanding_mountain_hiking` → T3
- `alpine_hiking` → T4
- `demanding_alpine_hiking` → T5
- `difficult_alpine_hiking` → T6

Raw values and the derivation method are retained in source provenance.

## Checkpoints, snapshots and lifecycle

Checkpoints are keyed by `(source, shard, activity)`. A capped run stores its next cursor and snapshot ID. A later run resumes that cursor. Only a successful completed snapshot may mark unseen records stale; partial, capped and failed runs never deactivate records. One source failure is logged and later sources continue.

Useful commands:

```bash
# Small UK OSM run, then resume it
npm run sync:routes -- --source=osm_geofabrik --shard=uk-england --activity=hiking --max=200

# Test a local PBF fixture without downloading
npm run sync:routes -- --source=osm_geofabrik --shard=uk-wales --local-file=/absolute/path/wales.osm.pbf --max=50

# Rotate one European OSM shard (the scheduled-job mode)
npm run sync:routes -- --source=osm_geofabrik --shard=rotate --max=500

# Select a Camptocamp activity and optional numeric area ID
npm run sync:routes -- --source=camptocamp --activity=rock_climbing --shard=1234 --max=500

# Inspect last runs and checkpoint outcomes
npm run sync:routes -- --health

# Classify one bounded batch without writing
npm run routes:reclassify -- --batch=250 --batches=1

# Apply bounded batches; resume from the reported nextCursor if needed
npm run routes:reclassify -- --apply --batch=250 --batches=10
npm run routes:reclassify -- --apply --batch=250 --batches=10 --after=<nextCursor>
```

`--no-resume` starts from the beginning without deleting the stored checkpoint. A reset needs both `--reset-checkpoint` and an exact confirmation token printed by the CLI, for example `--confirm-reset=osm_geofabrik:uk-england:hiking`.

The weekly GitHub workflow rotates one Geofabrik shard, caps downloads and record counts, and runs API/official overlays separately. Expect approximately twice the selected PBF size during an active download (cached target plus `.part`); the three parser passes do not create expanded OSM files. CI's temporary workspace is discarded after the job, while long-lived self-hosted runners may set `OSM_PBF_CACHE_DIR` to reuse ETags/downloads.

## Canonical matching and field precedence

Existing `(source, external ID)` links win first. New source records compare stable Wikidata, website and reference values before normalized name, country/region and geometry proximity. High-confidence matches auto-link to one canonical route. Medium-confidence matches create a review suggestion while retaining a separate route. Conflicting countries and low-confidence matches never auto-merge.

Field precedence is official agency (400) > OSM (300) > open community catalogue (200) > inference (100). Each canonical field records its winning source and precedence. Canonical routes are moderated data and are no longer editable through the user trail form; user-created geometry lives in `CustomTrail`.

## Cleanup and moderation

The reclassification command is dry-run by default, ordered by route UUID, bounded by `--batch` and `--batches`, and resumable with `--after`. It is idempotent: it updates source fingerprints/decisions and only adds a moderation event when the effective decision changes. Reports are grouped by source, state, and structured reason. It never deletes a route or source record, so climbs, reviews, saves, tags, and suggestions retain their foreign keys. A quarantined route may still be named in its owner's logbook, but public route detail returns 404 and public database views exclude it.

Server-only moderation helpers in `src/lib/routes/moderation.ts` list quarantined/pending routes and approve or reject one route with a mandatory reason. Every decision writes `RouteModerationEvent`. These helpers intentionally require a trusted server/service-role call; moderation tables are revoked from Supabase `anon` and `authenticated` roles.

### Production rollout order

1. Pause route sync jobs and run `npx prisma migrate deploy` against Supabase before deploying application code that expects the new columns.
2. Run `npm run routes:reclassify -- --batch=250 --batches=1` and inspect the dry-run source/reason totals.
3. Apply bounded batches with `--apply`; continue from the reported `nextCursor` until a batch processes fewer than its limit.
4. Deploy the application to Vercel, then resume the weekly sync. New imports are classified inline, so the cleanup command is only needed for pre-existing data or a future policy-version backfill.

The migration itself immediately approves only explicit agency sources and hides all other existing candidates, so there is no interval in which unevaluated data remains publicly discoverable. The GitHub sync workflow already runs `prisma migrate deploy`; ensure its `DATABASE_URL`/`DIRECT_URL` secrets target the same Supabase project as Vercel.

## Duration and elevation enrichment

When an authoritative hiking duration is absent, the sync stores a clearly calculated Naismith estimate: 60 minutes per 5 km plus 60 minutes per 600 m climbed. Source and calculated duration columns remain distinct.

`src/lib/importers/enrichment.ts` provides an optional batch DEM stage for a local Copernicus GLO-30-compatible tile cache. It samples at most 2,000 geometry points in one batch, applies a three-sample median, and ignores gains under three metres as DEM noise. Authoritative ascent is never replaced; calculated ascent is stored separately. Ordinary imports do not need DEM credentials or files.

## Adding an adapter

Implement `RouteImporter` in `src/lib/importers/`, accept injected fetch/file dependencies, yield normalized `ExternalRoute` values without discarding raw metadata, and return an `ImporterCompletion`. Register exact licence/attribution, add a minimal unrestricted fixture, test malformed data/cursors/snapshot completion, then add it to `scripts/sync-routes.ts`. Do not enable an endpoint whose reuse terms or ownership are ambiguous.
