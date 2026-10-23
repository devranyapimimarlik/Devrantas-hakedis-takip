const CACHE = "devrantas-v3";
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
  if (url.origin !== self.location.origin) return;
  const isApi = url.pathname.startsWith("/api/");
  const publicApi = url.pathname.startsWith("/api/settings/logo") || url.pathname.startsWith("/api/settings/manifest");
  if (isApi && !publicApi) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((res) => { caches.open(CACHE).then((c) => c.put("/", res.clone())); return res; }).catch(() => caches.match("/")));
    return;
  }
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
      return res;
    }).catch(() => caches.match(req))
  );
});

self.addEventListener("message", (e) => {
  if (e.data?.type === "clear-cache") e.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
});

self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: "Devrantaş", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(data.title || "Devrantaş", {
    body: data.body || "", icon: data.icon || "/api/settings/logo?size=192", badge: "/api/settings/logo?size=192",
    tag: data.tag, renotify: true, data: { url: data.url || "/" }, vibrate: [100, 50, 100],
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || "/", self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const existing = list.find((c) => c.url.startsWith(self.location.origin));
    if (existing) { existing.focus(); return existing.navigate ? existing.navigate(target) : null; }
    return self.clients.openWindow(target);
  }));
});

self.addEventListener("sync", (e) => {
  if (e.tag === "offline-queue") e.waitUntil(self.clients.matchAll({ type: "window" }).then((list) => list.forEach((c) => c.postMessage({ type: "flush-queue" }))));
});
