self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/* DSH Mobile — 通知点击处理 */
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
