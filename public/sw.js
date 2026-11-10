/* Push POC service worker: app-shell cache + push/click handlers. */
const CACHE = "push-poc-v4";
const SHELL = ["/", "/index.html", "/app.js", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/offline.html"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const { request } = e;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  // Navigations (incl. iOS start_url "/?source=pwa") always resolve to the cached shell.
  if (request.mode === "navigate") {
    e.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("/index.html", copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match("/index.html").then((hit) => hit || caches.match("/offline.html")))
    );
    return;
  }
  e.respondWith(
    caches.match(request, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(request).then(
          (res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
            }
            return res;
          },
          () => caches.match("/offline.html")
        )
    )
  );
});

self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data?.text?.() || "" }; }
  const title = data.title || "Push POC";
  const body = data.body || "You got a push notification.";
  const url = data.url || "/";
  e.waitUntil(
    self.registration.showNotification(title, {
      body, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png",
      data: { url }, tag: data.tag || "poc",
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  const full = new URL(url, self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin) { w.navigate(full).catch(() => {}); return w.focus(); }
      }
      return self.clients.openWindow(full);
    })
  );
});

self.addEventListener("pushsubscriptionchange", (e) => {
  e.waitUntil(
    (async () => {
      try {
        const r = await fetch("/api/vapid-public-key");
        const { publicKey } = await r.json();
        const pad = "=".repeat((4 - (publicKey.length % 4)) % 4);
        const bin = atob(publicKey.replace(/-/g, "+").replace(/_/g, "/") + pad);
        const key = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        await fetch("/api/subscriptions", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ subscription: sub.toJSON(), meta: { rotated: true } }),
        });
      } catch (err) { console.error("[poc] resubscribe failed", err); }
    })()
  );
});
