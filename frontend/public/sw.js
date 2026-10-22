const CACHE = "devrantas-v1";
const SHELL = ["/", "/api/settings/manifest.json", "/api/settings/logo"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const isApi = url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/settings/logo") && !url.pathname.startsWith("/api/settings/manifest");
  if (isApi) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((res) => { caches.open(CACHE).then((c) => c.put("/", res.clone())); return res; }).catch(() => caches.match("/")));
    return;
  }
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && (url.origin === self.location.origin)) caches.open(CACHE).then((c) => c.put(req, res.clone()));
      return res;
    }).catch(() => caches.match(req))
  );
});
