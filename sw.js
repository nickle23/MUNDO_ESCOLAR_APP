// Service worker PWA - auto-actualización para repartidores (sin borrar datos manualmente)
// Las llamadas al API no se cachean.

const CACHE = "me-rutas-v9";
const ASSETS = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/config.js",
  "./js/api.js",
  "./js/ui.js",
  "./js/app.js",
  "./manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Network-first para navegación y archivos de la app: trae la versión nueva cuando hay internet
  const isAppShell = req.mode === "navigate" ||
    ASSETS.some((a) => url.pathname.endsWith(a.replace("./", "/")) || url.pathname === "/" || url.pathname.endsWith("/index.html"));

  if (isAppShell) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        const copy = fresh.clone();
        const cache = await caches.open(CACHE);
        await cache.put(req, copy);
        return fresh;
      } catch (e) {
        const cached = await caches.match(req);
        return cached || caches.match("./index.html");
      }
    })());
    return;
  }

  // Otros assets same-origin: cache-first con actualización en segundo plano
  event.respondWith((async () => {
    const cached = await caches.match(req);
    const fetchPromise = fetch(req).then(async (res) => {
      try { const cache = await caches.open(CACHE); await cache.put(req, res.clone()); } catch (e) {}
      return res;
    }).catch(() => null);
    return cached || fetchPromise || Response.error();
  })());
});