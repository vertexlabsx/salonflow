self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  event.waitUntil(self.registration.showNotification(payload.title || "Aura Staff", {
    body: payload.body || "You have a new notification.",
    icon: payload.icon || "/assets/icons/icon.svg",
    badge: payload.badge || "/assets/icons/icon.svg",
    data: payload.data || { url: "/staff/notifications" },
    tag: payload.data?.staffNotificationId || "aura-staff-notification",
    renotify: true
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/staff/notifications", self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => client.url.startsWith(self.location.origin));
    if (existing) return existing.navigate(targetUrl).then(() => existing.focus());
    return clients.openWindow(targetUrl);
  }));
});
