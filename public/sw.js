self.addEventListener("push", (event) => {
  if (!event.data) return;

  let data = {};
  try {
    data = event.data.json();
  } catch {
    data = { title: "Pulsr Alert", body: event.data.text() };
  }

  const { title = "Pulsr Alert", body = "", icon = "/favicon.ico", tag, url } = data;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      tag,
      renotify: !!tag,
      requireInteraction: true,
      data: { url: url || "/admin/dashboard" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/admin/dashboard";
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if ("focus" in client) {
            client.focus();
            if ("navigate" in client) return client.navigate(url);
            return undefined;
          }
        }
        return clients.openWindow(url);
      })
  );
});
