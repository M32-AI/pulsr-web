self.addEventListener("push", (event) => {
  if (!event.data) return;

  let data = {};
  try {
    data = event.data.json();
  } catch {
    data = { title: "Pulsr Alert", body: event.data.text() };
  }

  const { title = "Pulsr Alert", body = "", icon = "/favicon.ico", tag } = data;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      tag,
      renotify: !!tag,
      requireInteraction: true,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if ("focus" in client) return client.focus();
        }
        return clients.openWindow("/admin/dashboard");
      })
  );
});
