const CACHE_NAME = "upi-qr-extractor-v5";
const OFFLINE_URL = "offline.html";

const ASSETS = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "manifest.json",
  "offline.html",
  "vendor/bootstrap.min.css",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "vendor/html5-qrcode.min.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(async (cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      try {
        const networkResponse = await fetch(event.request);
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, networkResponse.clone());
        return networkResponse;
      } catch {
        const requestUrl = new URL(event.request.url);
        if (event.request.mode === "navigate" || requestUrl.origin === self.location.origin) {
          const offlinePage = await caches.match(OFFLINE_URL);
          if (offlinePage) {
            return offlinePage;
          }
        }

        return new Response("Offline", {
          status: 503,
          statusText: "Offline",
          headers: { "Content-Type": "text/plain" }
        });
      }
    })
  );
});
