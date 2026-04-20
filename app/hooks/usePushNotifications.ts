"use client";

import { useState, useEffect, useCallback } from "react";
import { subscribePush, unsubscribePush, getVapidPublicKey } from "../lib/api";

type PushState = "unsupported" | "denied" | "subscribed" | "unsubscribed" | "loading";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function usePushNotifications() {
  const [state, setState] = useState<PushState>("loading");
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }

    navigator.serviceWorker
      .register("/sw.js")
      .then(async (reg) => {
        setRegistration(reg);
        const existing = await reg.pushManager.getSubscription();
        setState(existing ? "subscribed" : "unsubscribed");
      })
      .catch(() => setState("unsupported"));
  }, []);

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!registration) return false;
    setState("loading");
    try {
      const { publicKey } = await getVapidPublicKey();
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await subscribePush(subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } });
      setState("subscribed");
      return true;
    } catch {
      setState(Notification.permission === "denied" ? "denied" : "unsubscribed");
      return false;
    }
  }, [registration]);

  const unsubscribe = useCallback(async (): Promise<void> => {
    if (!registration) return;
    setState("loading");
    try {
      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        await unsubscribePush(existing.endpoint);
        await existing.unsubscribe();
      }
      setState("unsubscribed");
    } catch {
      setState("subscribed");
    }
  }, [registration]);

  const toggle = useCallback(async () => {
    if (state === "subscribed") {
      await unsubscribe();
    } else if (state === "unsubscribed") {
      await subscribe();
    }
  }, [state, subscribe, unsubscribe]);

  return { state, toggle };
}
