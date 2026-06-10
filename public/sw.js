// ============================================================
//  북부 경찰서 · 서비스워커 (백그라운드 푸시 알림)
//  탭이 백그라운드이거나 닫혀 있어도 푸시를 받아 알림을 띄웁니다.
// ============================================================

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { title: "북부 경찰서", body: event.data ? event.data.text() : "새 알람이 있습니다." };
  }
  const title = payload.title || "북부 경찰서";
  const options = {
    body: payload.body || "새 알람이 도착했습니다.",
    tag: payload.tag || "perfect-bank",
    renotify: true,
    requireInteraction: false,
    data: { url: payload.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.indexOf(self.location.origin) === 0 && "focus" in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
