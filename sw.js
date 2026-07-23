/* RubiTrails service worker — offline shell + opportunistic caching.
   Bump CACHE when you change index.html so clients pick up the new build. */
const CACHE = "rubitrails-v11";

// App shell precache. "./" and "./index.html" cover GitHub Pages project paths.
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon-180.png", "./icon-192.png", "./icon-512.png"];

// Cross-origin GETs we want available offline once they've been fetched.
const RUNTIME_HOSTS = [
  "unpkg.com",                 // React / ReactDOM UMD
  "fonts.googleapis.com",      // font CSS
  "fonts.gstatic.com",         // font files
  "tile.openstreetmap.org",    // map tiles already viewed
  "www.openstreetmap.org"      // map embed frame
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;

  // Never cache non-GET (Anthropic + Open-Meteo POST/dynamic calls just pass through).
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // App navigations: network-first, fall back to cached shell when offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  const sameOrigin = url.origin === self.location.origin;
  const runtime = RUNTIME_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith("." + h));

  // Don't touch live data APIs — always go to network.
  if (url.hostname === "api.anthropic.com" || url.hostname === "api.open-meteo.com") return;

  if (sameOrigin || runtime) {
    // Stale-while-revalidate: serve cache fast, refresh in background.
    e.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          const network = fetch(req)
            .then((res) => {
              if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()).catch(() => {});
              return res;
            })
            .catch(() => cached);
          return cached || network;
        })
      )
    );
  }
});
