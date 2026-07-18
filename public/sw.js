// Ascent Ledger service worker — read-only offline support (PLAN.md §7
// Phase 6). Strategy:
//   - page navigations: network-first, falling back to the last cached
//     copy, so any page you visited while online (logbook, dashboard,
//     climb details) still renders offline with the data it was rendered
//     with. No offline writes — mutations require the network.
//   - static assets (/_next/static, icons): cache-first (immutable).
//   - climb photos: cache-first with runtime fill, capped.
// Bump CACHE_VERSION to invalidate everything after a breaking change.

const CACHE_VERSION = "v1";
const PAGE_CACHE = `pages-${CACHE_VERSION}`;
const ASSET_CACHE = `assets-${CACHE_VERSION}`;
const IMAGE_CACHE = `images-${CACHE_VERSION}`;
const IMAGE_CACHE_LIMIT = 100;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = [PAGE_CACHE, ASSET_CACHE, IMAGE_CACHE];
      for (const key of await caches.keys()) {
        if (!keep.includes(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })()
  );
});

async function trimCache(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - limit; i++) {
    await cache.delete(keys[i]);
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    cache.put(request, response.clone());
    if (limit) trimCache(cacheName, limit);
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // never cache mutations

  const url = new URL(request.url);

  // Auth flows must always hit the network.
  if (url.pathname.startsWith("/auth") || url.pathname.startsWith("/sign-")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, PAGE_CACHE));
    return;
  }

  if (url.origin === self.location.origin) {
    if (
      url.pathname.startsWith("/_next/static/") ||
      url.pathname.startsWith("/icons/")
    ) {
      event.respondWith(cacheFirst(request, ASSET_CACHE));
    }
    return;
  }

  // Cross-origin images (climb photos on Supabase Storage): cache-first so
  // already-viewed photos work offline. Map tiles are deliberately not
  // cached (huge, and OSM's tile policy discourages it).
  if (request.destination === "image") {
    event.respondWith(cacheFirst(request, IMAGE_CACHE, IMAGE_CACHE_LIMIT));
  }
});
