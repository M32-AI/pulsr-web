"use client";

import { create } from "zustand";
import { apiSignIn, apiSignOut, apiRefreshSession, apiGetMe, SignInInput } from "@/app/lib/auth";

const STORAGE_KEY = "pulsr-auth";

// Decode JWT payload without a library
function getTokenExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

// Module-level state for proactive refresh timer and concurrent refresh dedup
let _refreshTimer: ReturnType<typeof setTimeout> | null = null;
let _refreshPromise: Promise<void> | null = null;

function scheduleProactiveRefresh(accessToken: string, refreshFn: () => Promise<void>) {
  if (_refreshTimer) clearTimeout(_refreshTimer);
  const expiry = getTokenExpiry(accessToken);
  if (!expiry) return;
  // Refresh 60 seconds before expiry
  const delay = expiry - Date.now() - 60_000;
  if (delay <= 0) {
    refreshFn();
    return;
  }
  _refreshTimer = setTimeout(refreshFn, delay);
}

function clearRefreshTimer() {
  if (_refreshTimer) {
    clearTimeout(_refreshTimer);
    _refreshTimer = null;
  }
}

interface User {
  id: string;
  email: string;
  name?: string;
  role?: string;
  user_metadata?: { name?: string };
}

interface StoredAuth {
  accessToken: string;
  refreshToken: string;
  user: User;
  assistantEmails: string[];
}

function loadStored(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredAuth) : null;
  } catch {
    return null;
  }
}

function saveStored(data: StoredAuth) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  document.cookie = "pulsr-authed=1; path=/; SameSite=Lax";
}

function clearStored() {
  localStorage.removeItem(STORAGE_KEY);
  document.cookie = "pulsr-authed=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
}

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  assistantEmails: string[];
  signIn: (input: SignInInput) => Promise<void>;
  signOut: () => Promise<void>;
  restoreSession: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  isAuthenticated: false,
  isLoading: true,
  user: null,
  accessToken: null,
  refreshToken: null,
  assistantEmails: [],

  signIn: async (input) => {
    const session = await apiSignIn(input);
    const user: User = {
      ...session.user,
      role: session.role,
    };
    const assistantEmails = session.assistant_emails ?? [];
    saveStored({ accessToken: session.access_token, refreshToken: session.refresh_token, user, assistantEmails });
    set({
      isAuthenticated: true,
      user,
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      assistantEmails,
    });
    scheduleProactiveRefresh(session.access_token, () => get().refreshSession().catch(() => {}));
  },

  signOut: async () => {
    clearRefreshTimer();
    _refreshPromise = null;
    const { accessToken } = get();
    if (accessToken) {
      await apiSignOut(accessToken).catch(() => {});
    }
    clearStored();
    set({ isAuthenticated: false, user: null, accessToken: null, refreshToken: null, assistantEmails: [] });
  },

  restoreSession: async () => {
    try {
      const stored = loadStored();
      if (!stored) return;

      // Optimistically restore state so UI renders immediately
      set({
        isAuthenticated: true,
        user: stored.user,
        accessToken: stored.accessToken,
        refreshToken: stored.refreshToken,
        assistantEmails: stored.assistantEmails ?? [],
      });

      // Validate the access token; if expired, proactively refresh
      const me = await apiGetMe(stored.accessToken);
      if (!me) {
        // Access token is expired or invalid — attempt a silent refresh
        try {
          await get().refreshSession();
        } catch {
          // Refresh token is also expired — clear everything and force re-login
          await get().signOut();
        }
      } else {
        scheduleProactiveRefresh(stored.accessToken, () => get().refreshSession().catch(() => {}));
      }
    } finally {
      set({ isLoading: false });
    }
  },

  refreshSession: () => {
    // Deduplicate concurrent refresh calls — all callers share the same in-flight promise
    if (_refreshPromise) return _refreshPromise;

    _refreshPromise = (async () => {
      const { refreshToken } = get();
      if (!refreshToken) {
        await get().signOut();
        throw new Error("No refresh token");
      }
      try {
        const session = await apiRefreshSession(refreshToken);
        const user: User = { ...session.user, role: session.role };
        const assistantEmails = session.assistant_emails ?? [];
        saveStored({ accessToken: session.access_token, refreshToken: session.refresh_token, user, assistantEmails });
        set({ isAuthenticated: true, accessToken: session.access_token, refreshToken: session.refresh_token, user, assistantEmails });
        scheduleProactiveRefresh(session.access_token, () => get().refreshSession().catch(() => {}));
      } catch (err) {
        // Refresh token expired or revoked — clear broken auth state
        await get().signOut();
        throw err;
      } finally {
        _refreshPromise = null;
      }
    })();

    return _refreshPromise;
  },
}));
