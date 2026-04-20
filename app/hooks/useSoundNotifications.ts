"use client";

import { useEffect, useRef, useCallback } from "react";
import type { Alert } from "../lib/api";

type SoundLevel = "soft" | "alert" | "severe";

function playTone(level: SoundLevel): void {
  try {
    const ctx = new AudioContext();

    const gainNode = ctx.createGain();
    gainNode.connect(ctx.destination);

    if (level === "severe") {
      // Two-tone alarm: 880Hz then 660Hz
      const playNote = (freq: number, start: number, duration: number) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.connect(g);
        g.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
        g.gain.setValueAtTime(0, ctx.currentTime + start);
        g.gain.linearRampToValueAtTime(0.35, ctx.currentTime + start + 0.02);
        g.gain.linearRampToValueAtTime(0, ctx.currentTime + start + duration);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + duration);
      };
      playNote(880, 0, 0.3);
      playNote(660, 0.35, 0.3);
      playNote(880, 0.7, 0.35);
    } else if (level === "alert") {
      // Single medium-pitched beep
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.connect(g);
      g.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.02);
      g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.25);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.25);
    } else {
      // Soft low beep
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.connect(g);
      g.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.02);
      g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.18);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.18);
    }

    // Clean up context after sounds finish
    setTimeout(() => ctx.close(), 2000);
  } catch {
    // AudioContext unavailable — silently skip
  }
}

function getSoundLevel(severity: Alert["severity"]): SoundLevel {
  if (severity === "severe") return "severe";
  if (severity === "alert") return "alert";
  return "soft";
}

export function useSoundNotifications(
  unreadCount: number,
  alerts: Alert[],
  muted: boolean
): void {
  const prevUnreadRef = useRef(unreadCount);
  const initializedRef = useRef(false);

  const triggerSound = useCallback(
    (newAlerts: Alert[]) => {
      if (muted || newAlerts.length === 0) return;
      // Use the highest severity among new alerts
      const hasSevere = newAlerts.some((a) => a.severity === "severe");
      const hasAlert = newAlerts.some((a) => a.severity === "alert");
      const level: SoundLevel = hasSevere ? "severe" : hasAlert ? "alert" : "soft";
      playTone(level);
    },
    [muted]
  );

  useEffect(() => {
    // Skip sound on the very first render (page load)
    if (!initializedRef.current) {
      initializedRef.current = true;
      prevUnreadRef.current = unreadCount;
      return;
    }

    if (unreadCount > prevUnreadRef.current) {
      // Find newly arrived unread alerts (those without an older counterpart)
      const newAlerts = alerts.filter((a) => !a.isRead).slice(0, unreadCount - prevUnreadRef.current);
      triggerSound(newAlerts);
    }

    prevUnreadRef.current = unreadCount;
  }, [unreadCount, alerts, triggerSound]);
}
