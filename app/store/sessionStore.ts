"use client";

import { create } from "zustand";
import { sessionStart, sessionStop, sessionRestore, SessionStatus } from "@/app/lib/api";

interface SessionUpdatePayload {
  sessionId: string;
  status: SessionStatus;
  startTime: string | null;
}

interface SessionState {
  sessionId: string | null;
  status: SessionStatus;
  startTime: string | null;
  isLoading: boolean;
  startSession: () => Promise<void>;
  stopSession: () => Promise<void>;
  restoreSession: () => Promise<void>;
  applyUpdate: (payload: SessionUpdatePayload) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessionId: null,
  status: "idle",
  startTime: null,
  isLoading: false,

  startSession: async () => {
    set({ isLoading: true });
    try {
      const result = await sessionStart();
      set({ sessionId: result.sessionId, status: result.status, startTime: result.startTime, isLoading: false });
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  stopSession: async () => {
    set({ isLoading: true });
    try {
      await sessionStop();
      set({ sessionId: null, status: "idle", startTime: null, isLoading: false });
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  restoreSession: async () => {
    const result = await sessionRestore();
    if (result) {
      set({ sessionId: result.sessionId, status: result.status, startTime: result.startTime });
    }
  },

  applyUpdate: (payload) => {
    set({ sessionId: payload.sessionId, status: payload.status, startTime: payload.startTime });
  },
}));
