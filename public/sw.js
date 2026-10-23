/*
 * Skhokho storefront service worker — Web Push only.
 *
 * It shows the order updates a customer asked for and opens the right page
 * when they tap one. It deliberately does NOT cache or intercept any
 * request: the storefront keeps working exactly as before, online only,
 * and nothing a shop changes can be served stale from here.
 *
 * The payload is JSON the server built (src/lib/messaging/providers/
 * webpush.ts): { title, body, url, tag }. Anything else shows a plain
 * "Order update" so a customer is never shown garbage.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function readPayload(event) {
  if (!event.data) return {};
  try {
    const data = event.data.json();
    return data && typeof data === "object" ? data : {};
  } catch {
    return { body: event.data.text() };
  }
}

self.addEventListener("push", (event) => {
  const data = readPayload(event);
  const title = typeof data.title === "string" && data.title ? data.title : "Order update";
  const body = typeof data.body === "string" ? data.body : "";
  const url = typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/";
  const tag = typeof data.tag === "string" && data.tag ? data.tag : undefined;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      renotify: Boolean(tag),
      // No icon or badge: the browser shows the site's own. The repo ships
      // no PNG app icon, and a broken image path shows as a blank square.
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (new URL(client.url).pathname === url && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
