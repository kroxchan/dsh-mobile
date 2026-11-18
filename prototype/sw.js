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
        if (convId && "navigate" in client) {
          try { await client.navigate(target); } catch {}
        }
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
