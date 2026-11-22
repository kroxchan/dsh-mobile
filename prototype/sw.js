/* DSH Mobile — app shell cache + push handlers */
const VERSION = new URL(self.location.href).searchParams.get("v") || "0";
const SHELL_CACHE = `dsh-mobile-shell-${VERSION}`;
const API_CACHE = `dsh-mobile-api-${VERSION}`;

function absolute(path) {
  return new URL(path, self.location.origin).toString();
}

const SHELL = [
  absolute("/__proto/"),
  absolute(`/__proto/app.js?v=${VERSION}`),
  absolute(`/__proto/data.js?v=${VERSION}`),
  absolute(`/__proto/styles.css?v=${VERSION}`),
  absolute(`/__proto/theme-flat.css?v=${VERSION}`),
  absolute(`/__proto/icon-192.png?v=${VERSION}`),
  absolute(`/__proto/manifest.webmanifest?v=${VERSION}`),
];

async function putSafe(cache, request, response) {
  if (!response || !response.ok) return;
  try { await cache.put(request, response.clone()); } catch {}
}

async function cacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  await Promise.allSettled(
    SHELL.map(async (url) => {
      const request = new Request(url, { credentials: "same-origin" });
      try {
        const response = await fetch(request, { cache: "reload" });
        await putSafe(cache, request, response);
      } catch {}
    })
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    await cacheShell();
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== SHELL_CACHE && key !== API_CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function networkFirstShell(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);
    if (response.ok) {
      await putSafe(cache, request, response);
      return response;
    }
    return response;
  } catch {
    return (
      (await cache.match("/__proto/")) ||
      (await cache.match(request)) ||
      (await caches.match("/__proto/")) ||
      Response.error()
    );
  }
}

async function cacheFirstShell(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    await putSafe(cache, request, response);
    return response;
  } catch {
    return (await cache.match("/__proto/")) || Response.error();
  }
}

async function networkFirstApi(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);
    if (response.ok) await putSafe(cache, request, response);
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return Response.json(
      { ok: false, error: { message: "网络暂时不可用，正在使用本地缓存" } },
      { status: 503, headers: { "content-type": "application/json" } }
    );
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  let url;
  try { url = new URL(request.url); } catch { return; }
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/__proto/")) {
    if (url.pathname.endsWith("/sw.js")) return;
    if (request.mode === "navigate") {
      event.respondWith(networkFirstShell(request));
      return;
    }
    event.respondWith(cacheFirstShell(request));
    return;
  }

  if (url.pathname.startsWith("/__im/") && !url.pathname.startsWith("/__im/events")) {
    event.respondWith(networkFirstApi(request));
  }
});

/* 通知点击处理 */
self.addEventListener("notificationclick", (event) => {
  const convId = event.notification?.data?.convId || "";
  event.notification.close();
  const target = "/__proto/" + (convId ? "#/chat/" + encodeURIComponent(convId) : "");
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) {
        await client.focus();
        client.postMessage({ type: "dsh-push-open", convId });
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch {}
  const title = payload.title || "DSH Mobile";
  const body = payload.body || "有新的任务进展";
  const convId = payload.convId || "";
  const tag = payload.tag || convId || title;
  event.waitUntil((async () => {
    await self.registration.showNotification(title, {
      body,
      tag,
      data: { convId },
      renotify: true,
    });
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clients) client.postMessage({ type: "dsh-push", convId, tag });
  })());
});
