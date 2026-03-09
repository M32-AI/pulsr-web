"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/app/store/authStore";
import { useSessionStore } from "@/app/store/sessionStore";

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isLoading, isAuthenticated, user, restoreSession } = useAuthStore();
  const restoreSessionStore = useSessionStore((s) => s.restoreSession);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  useEffect(() => {
    if (isAuthenticated) {
      restoreSessionStore().catch(() => {});
    }
  }, [isAuthenticated, restoreSessionStore]);

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      router.replace("/login");
    } else if (user?.role !== "admin") {
      router.replace("/unauthorized");
    }
  }, [isLoading, isAuthenticated, user, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <span className="text-xs font-mono text-zinc-600 tracking-widest uppercase">
          loading…
        </span>
      </div>
    );
  }

  if (!isAuthenticated || user?.role !== "admin") return null;

  return <>{children}</>;
}
