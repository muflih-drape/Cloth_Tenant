self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", function (event) {
  const data = event.data.json();

  self.registration.showNotification(data.title, {
    body: data.body,
    icon: "/web-app-manifest-192x192.png",
  });
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  event.waitUntil(clients.openWindow("/"));
});
