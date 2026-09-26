"use client";
import { useEffect } from "react";
import { api } from "@/lib/api";
import {
  registerServiceWorker,
  askNotificationPermission,
  getOrCreateSubscription,
} from "@/lib/push";

export default function PushNotificationInit() {
  useEffect(() => {
    async function initPush() {
      try {
        if (!("PushManager" in window)) {
          console.warn("Push API not supported in this browser");
          return;
        }

        await registerServiceWorker();
        await askNotificationPermission();

        const subscriptionJSON = await getOrCreateSubscription();

        if (
          !subscriptionJSON.endpoint ||
          !subscriptionJSON.keys?.p256dh ||
          !subscriptionJSON.keys?.auth
        ) {
          throw new Error("Subscription JSON is missing required fields");
        }

        await api.post(
          "/api/notification/save-subscription/",
          subscriptionJSON,
        );
        console.log("[Push] Subscription saved successfully");
      } catch (error) {
        console.error("[Push] Init failed:", error);
      }
    }

    initPush();
  }, []);

  return null;
}
