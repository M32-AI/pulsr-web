"use client";

import { useRouter } from "next/navigation";
import { useAuthStore } from "@/app/store/authStore";
import { useSessionStore } from "@/app/store/sessionStore";

export function useSignOut() {
  const router = useRouter();
  const signOut = useAuthStore((s) => s.signOut);
  const stopSession = useSessionStore((s) => s.stopSession);

  return async function handleSignOut() {
    try {
      await stopSession();
    } catch {
      // ignore — session may already be stopped
    }
    await signOut();
    router.push("/login");
  };
}
