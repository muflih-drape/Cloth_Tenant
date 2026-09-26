export async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service workers not supported");
  }
  await navigator.serviceWorker.register("/sw.js");
  return await navigator.serviceWorker.ready;
}

export async function askNotificationPermission(): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(`Notification permission not granted: ${permission}`);
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

function validateVapidKey(key: string): void {
  const bytes = urlBase64ToUint8Array(key);
  if (bytes.length !== 65) {
    throw new Error(`Invalid VAPID key length: ${bytes.length} (expected 65)`);
  }
  if (bytes[0] !== 4) {
    throw new Error(
      `Invalid VAPID key format: first byte is ${bytes[0]} (expected 4)`,
    );
  }
}

export async function getOrCreateSubscription(): Promise<PushSubscriptionJSON> {
  const publicVapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicVapidKey)
    throw new Error("NEXT_PUBLIC_VAPID_PUBLIC_KEY is missing");

  validateVapidKey(publicVapidKey);

  const registration = await navigator.serviceWorker.ready;
  const pushManager = registration.pushManager;

  const existing = await pushManager.getSubscription();
  if (existing) {
    return existing.toJSON();
  }

  try {
    const subscription = await pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicVapidKey)
        .buffer as ArrayBuffer,
    });
    return subscription.toJSON();
  } catch (err) {
    const error = err as DOMException;

    if (error.name === "AbortError") {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const retrySubscription = await pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicVapidKey)
          .buffer as ArrayBuffer,
      });
      return retrySubscription.toJSON();
    }

    if (error.name === "NotAllowedError") {
      throw new Error("Push blocked — notification permission denied.");
    }

    if (error.name === "InvalidStateError") {
      throw new Error("Service worker not active yet. Refresh the page.");
    }

    throw err;
  }
}
