"use client";

import { create } from "zustand";
import { apiSignIn, apiSignOut, apiRefreshSession, apiGetMe, SignInInput } from "@/app/lib/auth";

const STORAGE_KEY = "pulsr-auth";

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
  },

  signOut: async () => {
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
      }
    } finally {
      set({ isLoading: false });
    }
  },

  refreshSession: async () => {
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
    } catch (err) {
      // Refresh token expired or revoked — clear broken auth state
      await get().signOut();
      throw err;
    }
  },
}));
