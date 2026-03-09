/* eslint-disable no-nested-ternary */
"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthStore } from "../../store/authStore";
import { convertShiftToLocalTime, calculateShiftCountdown } from "../../lib/utils";
import VAAnalyticsSection from "../../components/VAAnalyticsSection";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

// ── Types ──────────────────────────────────────────────────────────────────

type VAStatus = "active" | "suspended" | "idle";

interface VAMetadata {
  first_name?: string;
  last_name?: string;
  role?: string;
  shift_start_time?: string;
  shift_end_time?: string;
  shift_time_zone?: string;
  country?: string;
  job_description?: string;
  client?: string;
  break_time?: string;
}

interface VASnapshot {
  vaId: string;
  email: string;
  status: VAStatus;
  sessionId: string | null;
  startTime: string | null;
  elapsedSeconds: number | null;
  todayTotalSeconds: number | null;
  idleSeconds: number;
  lastSeenAt: string | null;
  metadata: VAMetadata | null;
}

interface LiveResponse {
  generatedAt: string;
  totalVAs: number;
  activeCount: number;
  suspendedCount: number;
  idleCount: number;
  snapshot: VASnapshot[];
}

interface AdminScreenshot {
  id: string;
  sessionId: string;
  vaId: string;
  s3Key: string;
  s3Bucket: string;
  capturedAt: string;
  status: "pending" | "analyzed" | "failed";
  activeApplication: string | null;
  category: string | null;
  productivityScore: number | null;
  summary: string | null;
  presignedUrl: string | null;
}

interface AdminScreenshotsResponse {
  va_id: string;
  date?: string;
  offset: number;
  limit: number;
  hasNext: boolean;
  total: number;
  screenshots: AdminScreenshot[];
}

interface DailySummary {
  va_id: string;
  date: string;
  timezone: string;
  utcStart: string;
  utcEnd: string;
  total: number;
  startTimestamp: string | null;
  endTimestamp: string | null;
  avgProductivityScore: number | null;
}

interface HourSlot {
  startHour: number;
  startLabel: string;
  endLabel: string;
  startISO: string;
  endISO: string;
}

type SlotStatus = "idle" | "loading" | "loaded" | "error";

interface SlotData {
  status: SlotStatus;
  screenshots: AdminScreenshot[];
  avgProductivity: number | null;
  riskLevel: "low" | "moderate" | "critical" | "no-data";
  riskLabel: string;
  summaryText: string;
  error?: string;
}

interface JobDescription {
  id: string;
  vaId: string;
  title: string | null;
  description: string;
  personalizedPrompt: string | null;
  createdBy: string;
  isActive: boolean;
  deactivatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function displayName(email: string, metadata?: VAMetadata | null): string {
  if (metadata?.first_name || metadata?.last_name) {
    return [metadata.first_name, metadata.last_name].filter(Boolean).join(" ");
  }
  return email
    .split("@")[0]
    .replace(/[._-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatElapsed(seconds: number | null): string {
  if (seconds === null || seconds === 0) return "--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatTimeHHMM(hour: number): string {
  const h = hour % 24;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:00 ${ampm}`;
}

function parseShiftHour(timeStr: string | undefined): number {
  if (!timeStr) return 9;
  const [h] = timeStr.split(":").map(Number);
  return h;
}

function getStatusBadge(va: VASnapshot): { label: string; className: string } {
  const productivity = va.todayTotalSeconds
    ? (va.todayTotalSeconds - va.idleSeconds) / va.todayTotalSeconds
    : 0;

  if (va.status === "idle") {
    return { label: "Offline", className: "bg-gray-100 text-gray-500" };
  }
  if (va.status === "suspended") {
    return {
      label: "Attention",
      className: "bg-amber-100 text-amber-700 border border-amber-200",
    };
  }
  if (productivity < 0.4 && va.todayTotalSeconds && va.todayTotalSeconds > 1800) {
    return {
      label: "Intervention",
      className: "bg-red-100 text-red-600 border border-red-200",
    };
  }
  if (productivity < 0.6 && va.todayTotalSeconds && va.todayTotalSeconds > 1800) {
    return {
      label: "At Risk",
      className: "bg-red-100 text-red-600 border border-red-200",
    };
  }
  return {
    label: "On Track",
    className: "bg-emerald-100 text-emerald-700 border border-emerald-200",
  };
}

function getRiskScore(va: VASnapshot): number {
  if (!va.todayTotalSeconds || va.todayTotalSeconds === 0) return 0;
  const activeRatio =
    (va.todayTotalSeconds - va.idleSeconds) / va.todayTotalSeconds;
  return Math.round(activeRatio * 10);
}

function getLocalHour(utcISO: string, timezone: string): number {
  try {
    const d = new Date(utcISO);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const hourPart = parts.find((p) => p.type === "hour");
    return hourPart ? parseInt(hourPart.value, 10) % 24 : d.getUTCHours();
  } catch {
    return new Date(utcISO).getHours();
  }
}

function computeSlotRisk(
  slotScreenshots: AdminScreenshot[],
): Pick<SlotData, "avgProductivity" | "riskLevel" | "riskLabel" | "summaryText"> {
  const analyzedScreenshots = slotScreenshots.filter(
    (s) => s.productivityScore !== null,
  );
  const avgProductivity =
    analyzedScreenshots.length > 0
      ? Math.round(
          analyzedScreenshots.reduce(
            (sum, s) => sum + (s.productivityScore ?? 0),
            0,
          ) / analyzedScreenshots.length,
        )
      : null;

  if (slotScreenshots.length === 0) {
    return {
      avgProductivity: null,
      riskLevel: "no-data",
      riskLabel: "No Data",
      summaryText: "No activity recorded for this period.",
    };
  }
  if (avgProductivity === null) {
    return {
      avgProductivity: null,
      riskLevel: "no-data",
      riskLabel: "Pending Analysis",
      summaryText: `${slotScreenshots.length} screenshot(s) captured, analysis pending.`,
    };
  }
  if (avgProductivity >= 70) {
    return {
      avgProductivity,
      riskLevel: "low",
      riskLabel: "No/Low Risk",
      summaryText:
        analyzedScreenshots[0]?.summary ??
        "The virtual talent did their job as expected; there was no risk identified.",
    };
  }
  if (avgProductivity >= 40) {
    return {
      avgProductivity,
      riskLevel: "moderate",
      riskLabel: "Moderate Risk",
      summaryText:
        analyzedScreenshots[0]?.summary ??
        "Some periods of reduced productivity detected.",
    };
  }
  const lowScoreCount = analyzedScreenshots.filter(
    (s) => (s.productivityScore ?? 0) < 40,
  ).length;
  return {
    avgProductivity,
    riskLevel: "critical",
    riskLabel: "CRITICAL Risk Detected",
    summaryText:
      analyzedScreenshots[0]?.summary ??
      `High period of inactivity detected. ${lowScoreCount} low-productivity screenshot(s) found.`,
  };
}

function computeHourSlots(
  startTimestamp: string | null,
  endTimestamp: string | null,
  date: string,
  shiftStartHour: number,
  shiftEndHour: number,
  timezone: string,
): HourSlot[] {
  let fromHour: number;
  let toHour: number;

  if (startTimestamp && endTimestamp) {
    fromHour = getLocalHour(startTimestamp, timezone);
    toHour = getLocalHour(endTimestamp, timezone);
  } else {
    fromHour = shiftStartHour;
    toHour = Math.min(shiftEndHour, new Date().getHours());
  }

  if (fromHour > toHour && !startTimestamp) return [];

  const slots: HourSlot[] = [];
  const endInclusive = startTimestamp ? toHour : toHour - 1;

  for (let h = fromHour; h <= endInclusive; h += 1) {
    const hour = h % 24;
    const paddedHour = hour.toString().padStart(2, "0");
    const nextH = h + 1;
    const nextHour = (nextH % 24).toString().padStart(2, "0");
    const endDateStr =
      nextH >= 24
        ? (() => {
            const d = new Date(`${date}T00:00:00`);
            d.setDate(d.getDate() + 1);
            return d.toISOString().split("T")[0];
          })()
        : date;

    slots.push({
      startHour: hour,
      startLabel: formatTimeHHMM(hour),
      endLabel: formatTimeHHMM(nextH),
      startISO: `${date}T${paddedHour}:00:00`,
      endISO: `${endDateStr}T${nextHour}:00:00`,
    });
  }

  return slots;
}

function scoreColor(score: number | null): string {
  if (score === null) return "bg-gray-200 text-gray-400";
  if (score >= 80) return "bg-emerald-100 text-emerald-700";
  if (score >= 50) return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-600";
}

function scoreBarColor(score: number | null): string {
  if (score === null) return "bg-gray-300";
  if (score >= 80) return "bg-emerald-500";
  if (score >= 50) return "bg-amber-400";
  return "bg-red-400";
}

function formatISOTime(isoStr: string | null | undefined): string {
  if (!isoStr) return "--";
  return new Date(isoStr).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

const STATUS_ORDER: Record<VAStatus, number> = {
  active: 0,
  suspended: 1,
  idle: 2,
};

const REFRESH_INTERVAL = 30_000;

// ── VA Sidebar Card ────────────────────────────────────────────────────────

function VACard({
  va,
  isSelected,
  onClick,
}: {
  va: VASnapshot;
  isSelected: boolean;
  onClick: () => void;
}) {
  const meta = va.metadata;
  const name = displayName(va.email, meta);
  const badge = getStatusBadge(va);
  const score = getRiskScore(va);

  const shiftStart = meta?.shift_start_time ?? "";
  const shiftEnd = meta?.shift_end_time ?? "";
  const shiftTZ = meta?.shift_time_zone ?? "";

  let shiftLabel = "--";
  if (shiftStart && shiftEnd) {
    try {
      const local = convertShiftToLocalTime({
        shift_start_time: shiftStart,
        shift_end_time: shiftEnd,
        shift_time_zone: shiftTZ,
      });
      shiftLabel = `${local.localStartTime} - ${local.localEndTime}`;
    } catch {
      shiftLabel = `${shiftStart} - ${shiftEnd}`;
    }
  }

  let countdown = "";
  if (shiftStart && shiftEnd && shiftTZ) {
    try {
      const cd = calculateShiftCountdown(shiftStart, shiftEnd, shiftTZ);
      countdown = cd.ending_in === "Started" ? "" : `${cd.ending_in} left`;
    } catch {
      countdown = "";
    }
  }

  const startStatus =
    va.status === "active"
      ? { label: formatISOTime(va.startTime), isLate: false }
      : { label: "--", isLate: false };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left p-3 border-b border-gray-100 transition-colors ${
        isSelected
          ? "bg-blue-50 border-l-2 border-l-blue-500"
          : "hover:bg-gray-50 border-l-2 border-l-transparent"
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center shrink-0">
            <span className="text-xs font-semibold text-gray-500">
              {name.charAt(0)}
            </span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold text-gray-900 truncate">
                {name}
              </p>
              {meta?.country && (
                <span className="text-xs">{meta.country}</span>
              )}
            </div>
            <p className="text-xs text-gray-400 truncate">
              {meta?.role ?? va.email}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.className}`}
          >
            {badge.label}
          </span>
          <span className="text-[10px] font-medium text-gray-400">
            {score}/10
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1.5 text-[10px] text-gray-400 mb-2">
        <svg
          className="w-3 h-3 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        <span className="font-medium uppercase">Full Shift:</span>
        <span>{shiftLabel}</span>
      </div>

      <div className="grid grid-cols-4 gap-2 text-[10px]">
        <div>
          <p className="text-gray-400 uppercase font-medium">Client</p>
          <p className="text-gray-700 font-medium truncate">
            {meta?.client ?? "--"}
          </p>
        </div>
        <div>
          <p className="text-gray-400 uppercase font-medium">Start</p>
          <p className="text-gray-700 font-medium">{startStatus.label}</p>
          {va.status === "active" && (
            <p className="text-emerald-500 text-[9px]">On Time</p>
          )}
        </div>
        <div>
          <p className="text-gray-400 uppercase font-medium">Break</p>
          <p className="text-gray-700 font-medium">
            {meta?.break_time ?? "--"}
          </p>
        </div>
        <div>
          <p className="text-gray-400 uppercase font-medium">Ends</p>
          <p className="text-gray-700 font-medium">
            {shiftEnd
              ? convertShiftToLocalTime({
                  shift_start_time: shiftStart || "09:00",
                  shift_end_time: shiftEnd,
                  shift_time_zone: shiftTZ || "UTC",
                }).localEndTime || "--"
              : "--"}
          </p>
          {countdown && (
            <p className="text-blue-500 text-[9px]">{countdown}</p>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Hour Activity Card ─────────────────────────────────────────────────────

function HourActivityCard({
  slot,
  slotData,
  isExpanded,
  onToggle,
}: {
  slot: HourSlot;
  slotData: SlotData | undefined;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const [lightbox, setLightbox] = useState<AdminScreenshot | null>(null);

  const riskLevel =
    slotData?.status === "loaded" ? slotData.riskLevel : "no-data";

  const riskStyles: Record<
    SlotData["riskLevel"],
    {
      border: string;
      bg: string;
      icon: string;
      badgeBg: string;
      badgeText: string;
      dot: string;
    }
  > = {
    low: {
      border: "border-emerald-200",
      bg: "bg-white",
      icon: "text-emerald-500",
      badgeBg: "bg-emerald-100",
      badgeText: "text-emerald-700",
      dot: "border-emerald-400 bg-emerald-100",
    },
    moderate: {
      border: "border-amber-200",
      bg: "bg-amber-50/30",
      icon: "text-amber-500",
      badgeBg: "bg-amber-100",
      badgeText: "text-amber-700",
      dot: "border-amber-400 bg-amber-100",
    },
    critical: {
      border: "border-red-200",
      bg: "bg-red-50/30",
      icon: "text-red-500",
      badgeBg: "bg-red-100",
      badgeText: "text-red-700",
      dot: "border-red-400 bg-red-100",
    },
    "no-data": {
      border: "border-gray-200",
      bg: "bg-gray-50/30",
      icon: "text-gray-400",
      badgeBg: "bg-gray-100",
      badgeText: "text-gray-500",
      dot: "border-gray-300 bg-gray-100",
    },
  };

  const style = riskStyles[riskLevel];

  useEffect(() => {
    if (!lightbox) return undefined;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightbox]);

  const isLoading = slotData?.status === "loading";
  const isLoaded = slotData?.status === "loaded";
  const isError = slotData?.status === "error";
  const screenshots = slotData?.screenshots ?? [];

  return (
    <>
      <div className="flex gap-3">
        <div className="flex flex-col items-center pt-1">
          <div className={`w-2.5 h-2.5 rounded-full border-2 ${style.dot}`} />
          <div className="w-px flex-1 bg-gray-200 mt-1" />
        </div>

        <div
          className={`flex-1 mb-4 rounded-lg border ${style.border} ${style.bg} overflow-hidden`}
        >
          <div className="px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                {isLoading ? (
                  <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
                ) : riskLevel === "low" ? (
                  <svg
                    className={`w-4 h-4 ${style.icon}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : (
                  <svg
                    className={`w-4 h-4 ${style.icon}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                )}
                <div>
                  <span className="text-sm font-semibold text-gray-900">
                    {slot.startLabel} - {slot.endLabel}
                  </span>
                  {isLoaded && (
                    <span
                      className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${style.badgeBg} ${style.badgeText}`}
                    >
                      {slotData!.riskLabel}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={onToggle}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-0.5 shrink-0"
              >
                {isExpanded ? "HIDE" : "VIEW DETAILS"}
                <svg
                  className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
            </div>

            <p className="text-xs text-gray-500 mt-1 ml-6">
              {isLoaded
                ? slotData!.summaryText
                : isLoading
                  ? "Loading screenshots…"
                  : isError
                    ? (slotData!.error ?? "Failed to load screenshots.")
                    : "Click VIEW DETAILS to load activity data."}
            </p>
          </div>

          {isExpanded && isLoading && (
            <div className="border-t border-gray-100 px-4 py-8 flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-gray-400">Fetching screenshots…</p>
            </div>
          )}

          {isExpanded && isError && (
            <div className="border-t border-gray-100 px-4 py-6 flex flex-col items-center justify-center gap-1">
              <p className="text-xs text-red-500 font-medium">Failed to load</p>
              <p className="text-xs text-gray-400">{slotData!.error}</p>
            </div>
          )}

          {isExpanded && !slotData && (
            <div className="border-t border-gray-100 px-4 py-6 flex items-center justify-center">
              <p className="text-xs text-gray-400">Click VIEW DETAILS to load</p>
            </div>
          )}

          {isExpanded && isLoaded && screenshots.length > 0 && (
            <div className="border-t border-gray-100 px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-gray-500">
                  {screenshots.length} screenshot(s) captured
                </p>
                {slotData!.avgProductivity !== null && (
                  <span className="text-xs text-gray-400">
                    Avg productivity:{" "}
                    <span
                      className={`font-semibold ${
                        slotData!.avgProductivity >= 70
                          ? "text-emerald-600"
                          : slotData!.avgProductivity >= 40
                            ? "text-amber-600"
                            : "text-red-600"
                      }`}
                    >
                      {slotData!.avgProductivity}%
                    </span>
                  </span>
                )}
              </div>
              <div className="grid grid-cols-4 gap-2">
                {screenshots.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setLightbox(s)}
                    className="group relative aspect-video rounded-lg overflow-hidden border border-gray-200 bg-gray-100 hover:border-blue-400 hover:shadow-md transition-all focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    {s.presignedUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={s.presignedUrl}
                        alt={`Screenshot at ${s.capturedAt}`}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gray-50">
                        <svg
                          className="w-5 h-5 text-gray-300"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                        >
                          <rect x="3" y="3" width="18" height="18" rx="2" />
                          <circle cx="8.5" cy="8.5" r="1.5" />
                          <path d="m21 15-5-5L5 21" />
                        </svg>
                      </div>
                    )}
                    {s.productivityScore !== null && (
                      <div
                        className={`absolute top-1 right-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${scoreColor(s.productivityScore)}`}
                      >
                        {s.productivityScore}
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                      <p className="text-white text-[10px] font-medium leading-tight truncate">
                        {s.activeApplication ?? "Unknown app"}
                      </p>
                      <p className="text-white/60 text-[9px] leading-tight">
                        {formatISOTime(s.capturedAt)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>

              <div className="mt-3 space-y-2">
                {screenshots
                  .filter((s) => s.summary)
                  .map((s) => (
                    <div
                      key={s.id}
                      className="flex items-start gap-2 text-xs text-gray-500 bg-gray-50 rounded-md px-3 py-2"
                    >
                      <span className="text-gray-400 shrink-0 font-mono">
                        {formatISOTime(s.capturedAt)}
                      </span>
                      <span className="flex-1">{s.summary}</span>
                      {s.productivityScore !== null && (
                        <span
                          className={`shrink-0 font-semibold ${
                            s.productivityScore >= 70
                              ? "text-emerald-600"
                              : s.productivityScore >= 40
                                ? "text-amber-600"
                                : "text-red-600"
                          }`}
                        >
                          {s.productivityScore}%
                        </span>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}

          {isExpanded && isLoaded && screenshots.length === 0 && (
            <div className="border-t border-gray-100 px-4 py-6 flex items-center justify-center">
              <p className="text-xs text-gray-400">
                No screenshots captured during this period
              </p>
            </div>
          )}
        </div>
      </div>

      {lightbox && (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div
            className="relative w-full max-w-4xl max-h-[90vh] flex flex-col bg-gray-950 rounded-2xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              aria-label="Close"
              type="button"
              onClick={() => setLightbox(null)}
              className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center bg-black/60 backdrop-blur-sm rounded-full text-white hover:bg-black/80 transition-colors"
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>

            <div className="flex-1 overflow-hidden bg-black min-h-0">
              {lightbox.presignedUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={lightbox.presignedUrl}
                  alt="Screenshot"
                  className="w-full h-full object-contain max-h-[60vh]"
                />
              ) : (
                <div className="w-full h-48 flex flex-col items-center justify-center text-gray-600">
                  <svg
                    className="w-10 h-10 mb-2"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="m21 15-5-5L5 21" />
                  </svg>
                  <p className="text-sm">Image not available</p>
                </div>
              )}
            </div>

            <div className="bg-gray-900 px-5 py-4 shrink-0">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <p className="text-white font-semibold text-sm">
                    {lightbox.activeApplication ?? "Unknown Application"}
                  </p>
                  <p className="text-gray-400 text-xs mt-0.5">
                    {new Date(lightbox.capturedAt).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                      hour12: true,
                    })}
                    {lightbox.category && (
                      <span className="ml-2 text-gray-500">
                        &middot; {lightbox.category}
                      </span>
                    )}
                  </p>
                </div>
                <span
                  className={`shrink-0 inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                    lightbox.status === "analyzed"
                      ? "bg-emerald-900/60 text-emerald-400"
                      : lightbox.status === "failed"
                        ? "bg-red-900/60 text-red-400"
                        : "bg-gray-800 text-gray-400"
                  }`}
                >
                  {lightbox.status}
                </span>
              </div>

              {lightbox.productivityScore !== null && (
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-400">
                      Productivity Score
                    </span>
                    <span
                      className={`text-xs font-bold ${
                        lightbox.productivityScore >= 80
                          ? "text-emerald-400"
                          : lightbox.productivityScore >= 50
                            ? "text-amber-400"
                            : "text-red-400"
                      }`}
                    >
                      {lightbox.productivityScore}/100
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-gray-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${scoreBarColor(lightbox.productivityScore)}`}
                      style={{ width: `${lightbox.productivityScore}%` }}
                    />
                  </div>
                </div>
              )}

              {lightbox.summary && (
                <p className="text-gray-300 text-xs leading-relaxed">
                  {lightbox.summary}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Job Description Modal ──────────────────────────────────────────────────

function JobDescriptionModal({
  va,
  accessToken,
  onClose,
  onSaved,
}: {
  va: VASnapshot;
  accessToken: string | null;
  onClose: () => void;
  onSaved: (description: string) => void;
}) {
  const [history, setHistory] = useState<JobDescription[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoadingHistory(true);
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/job-descriptions?va_id=${va.vaId}`,
          {
            headers: accessToken
              ? { Authorization: `Bearer ${accessToken}` }
              : {},
          },
        );
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const data = await res.json();
        const jds: JobDescription[] = data.jobDescriptions ?? [];
        setHistory(jds);
        const active = jds.find((j) => j.isActive);
        if (active) {
          setTitle(active.title ?? "");
          setDescription(active.description);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load history");
      } finally {
        setLoadingHistory(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [va.vaId, accessToken]);

  const handleSave = async () => {
    if (description.trim().length < 10) {
      setError("Description must be at least 10 characters.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/job-descriptions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          vaId: va.vaId,
          title: title.trim() || undefined,
          description: description.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? `Server returned ${res.status}`);
      }
      onSaved(description.trim());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/job-descriptions/${id}`, {
        method: "DELETE",
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? `Server returned ${res.status}`);
      }
      setHistory((prev) =>
        prev.map((j) => (j.id === id ? { ...j, isActive: false } : j)),
      );
      setTitle("");
      setDescription("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900">
            Job Description —{" "}
            {va.metadata?.first_name ?? va.email.split("@")[0]}
          </h2>
          <button
            aria-label="Close"
            type="button"
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md text-gray-400 hover:bg-gray-100"
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loadingHistory ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {error && (
                <p className="text-xs text-red-500 bg-red-50 rounded-md px-3 py-2">
                  {error}
                </p>
              )}

              <div className="space-y-3">
                <div>
                  <label
                    className="block text-xs font-medium text-gray-600 mb-1"
                    htmlFor="jd-title"
                  >
                    Title{" "}
                    <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <input
                    id="jd-title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={200}
                    placeholder="e.g. Customer Support Specialist"
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400 placeholder:text-gray-300"
                  />
                </div>
                <div>
                  <label
                    className="block text-xs font-medium text-gray-600 mb-1"
                    htmlFor="jd-description"
                  >
                    Description <span className="text-red-400">*</span>
                  </label>
                  <textarea
                    id="jd-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={6}
                    maxLength={5000}
                    placeholder="Describe the VA's responsibilities, tools used, and what productive work looks like…"
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400 placeholder:text-gray-300 resize-none"
                  />
                  <p className="text-[10px] text-gray-400 mt-0.5 text-right">
                    {description.length}/5000
                  </p>
                </div>
              </div>

              {history.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowHistory((v) => !v)}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
                  >
                    <svg
                      className={`w-3 h-3 transition-transform ${showHistory ? "rotate-90" : ""}`}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                    Version history ({history.length})
                  </button>

                  {showHistory && (
                    <div className="mt-2 space-y-2">
                      {history.map((jd) => (
                        <div
                          key={jd.id}
                          className="border border-gray-100 rounded-lg px-3 py-2.5 bg-gray-50"
                        >
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              {jd.title && (
                                <span className="text-xs font-medium text-gray-700">
                                  {jd.title}
                                </span>
                              )}
                              {jd.isActive && (
                                <span className="inline-flex items-center rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700">
                                  ACTIVE
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-gray-400">
                                {new Date(jd.createdAt).toLocaleDateString()}
                              </span>
                              {jd.isActive && (
                                <button
                                  type="button"
                                  onClick={() => handleDelete(jd.id)}
                                  className="text-[10px] text-red-400 hover:text-red-600"
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                          </div>
                          <p className="text-xs text-gray-500 line-clamp-2">
                            {jd.description}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium text-gray-600 rounded-lg border border-gray-200 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || description.trim().length < 10}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving && (
              <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
            )}
            {saving ? "Saving…" : "Save Description"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Right Panel: VA Detail ─────────────────────────────────────────────────

function VADetailPanel({
  va,
  accessToken,
  date,
  role,
}: {
  va: VASnapshot;
  accessToken: string | null;
  date: string;
  role: string | undefined;
}) {
  const router = useRouter();
  const [dailySummary, setDailySummary] = useState<DailySummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [slotData, setSlotData] = useState<Record<number, SlotData>>({});
  const [expandedSlot, setExpandedSlot] = useState<number | null>(null);
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [showJdModal, setShowJdModal] = useState(false);
  const [localJobDescription, setLocalJobDescription] = useState<string | null>(null);

  const meta = va.metadata;
  const name = displayName(va.email, meta);
  const score = getRiskScore(va);
  const today = date;
  const timezone = meta?.shift_time_zone ?? "UTC";

  const fetchDailySummary = useCallback(async () => {
    setLoadingSummary(true);
    try {
      const url = `${API_BASE_URL}/admin/screenshots/daily-summary?va_id=${va.vaId}&date=${today}&timezone=${encodeURIComponent(timezone)}`;
      const res = await fetch(url, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const json: DailySummary = await res.json();
      setDailySummary(json);
      setSlotData({});
      setExpandedSlot(null);
    } catch {
      setDailySummary(null);
    } finally {
      setLoadingSummary(false);
    }
  }, [va.vaId, today, accessToken, timezone]);

  useEffect(() => {
    fetchDailySummary();
  }, [fetchDailySummary]);

  const fetchSlotData = useCallback(
    async (slot: HourSlot) => {
      setSlotData((prev) => ({
        ...prev,
        [slot.startHour]: {
          status: "loading",
          screenshots: [],
          avgProductivity: null,
          riskLevel: "no-data",
          riskLabel: "Loading…",
          summaryText: "",
        },
      }));
      try {
        const params = new URLSearchParams({
          va_id: va.vaId,
          start: slot.startISO,
          end: slot.endISO,
          timezone,
          limit: "100",
        });
        const allScreenshots: AdminScreenshot[] = [];
        let offset = 0;
        let hasMore = true;
        while (hasMore) {
          params.set("offset", offset.toString());
          const res = await fetch(
            `${API_BASE_URL}/admin/screenshots?${params}`,
            {
              headers: accessToken
                ? { Authorization: `Bearer ${accessToken}` }
                : {},
            },
          );
          if (!res.ok) throw new Error(`Server returned ${res.status}`);
          const json: AdminScreenshotsResponse = await res.json();
          allScreenshots.push(...json.screenshots);
          hasMore = json.hasNext;
          offset += json.screenshots.length;
        }
        const risk = computeSlotRisk(allScreenshots);
        setSlotData((prev) => ({
          ...prev,
          [slot.startHour]: {
            status: "loaded",
            screenshots: allScreenshots,
            ...risk,
          },
        }));
      } catch (e) {
        setSlotData((prev) => ({
          ...prev,
          [slot.startHour]: {
            status: "error",
            screenshots: [],
            avgProductivity: null,
            riskLevel: "no-data",
            riskLabel: "Error",
            summaryText: "",
            error: e instanceof Error ? e.message : "Unknown error",
          },
        }));
      }
    },
    [va.vaId, timezone, accessToken],
  );

  const handleSlotToggle = useCallback(
    (slot: HourSlot) => {
      setExpandedSlot((prev) => {
        const isCollapsing = prev === slot.startHour;
        if (!isCollapsing) {
          const existing = slotData[slot.startHour];
          if (!existing || existing.status === "idle") {
            fetchSlotData(slot);
          }
        }
        return isCollapsing ? null : slot.startHour;
      });
    },
    [slotData, fetchSlotData],
  );

  const shiftStartHour = parseShiftHour(meta?.shift_start_time);
  const shiftEndHour = parseShiftHour(meta?.shift_end_time);
  const hourSlots = useMemo(
    () =>
      computeHourSlots(
        dailySummary?.startTimestamp ?? null,
        dailySummary?.endTimestamp ?? null,
        today,
        shiftStartHour,
        shiftEndHour,
        timezone,
      ),
    [dailySummary, today, shiftStartHour, shiftEndHour, timezone],
  );

  const avgProductivity = dailySummary?.avgProductivityScore ?? null;
  const activeTimeFormatted = formatElapsed(va.todayTotalSeconds);

  const now = new Date();
  const localTime = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const estTime = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  });
  const pstTime = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Los_Angeles",
  });

  let shiftStartDisplay = "--";
  let shiftStartLate = "";
  if (meta?.shift_start_time && meta?.shift_time_zone) {
    try {
      const local = convertShiftToLocalTime({
        shift_start_time: meta.shift_start_time,
        shift_end_time: meta.shift_end_time || "17:00",
        shift_time_zone: meta.shift_time_zone,
      });
      shiftStartDisplay = local.localStartTime;
    } catch {
      shiftStartDisplay = meta.shift_start_time;
    }

    if (va.startTime) {
      const shiftStartDate = new Date();
      const [sh, sm] = meta.shift_start_time.split(":").map(Number);
      shiftStartDate.setHours(sh, sm, 0, 0);
      const actualStart = new Date(va.startTime);
      const diffMin = Math.round(
        (actualStart.getTime() - shiftStartDate.getTime()) / 60000,
      );
      if (diffMin > 5) {
        shiftStartLate = `${diffMin} mins Late`;
      }
    }
  }

  return (
    <div className="flex-1 min-w-0 overflow-y-auto max-h-screen">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="relative">
              <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center">
                <span className="text-lg font-semibold text-gray-500">
                  {name.charAt(0)}
                </span>
              </div>
              {va.status === "active" && (
                <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-white" />
              )}
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-gray-900">{name}</h1>
                {meta?.country && (
                  <span className="text-base">{meta.country}</span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-0.5">
                <div className="flex items-center gap-1.5 text-sm text-gray-500">
                  <svg
                    className="w-3.5 h-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  {meta?.role ?? "N/A"}
                </div>
                {meta?.client && (
                  <span className="inline-flex items-center rounded-full bg-blue-50 border border-blue-200 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                    Active on: {meta.client}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span>{localTime} Local</span>
              <span className="text-gray-200">|</span>
              <span>{estTime} EST</span>
              <span className="text-gray-200">|</span>
              <span>{pstTime} PST</span>
            </div>

            <div className="text-right">
              <p className="text-[10px] text-gray-400 uppercase font-medium">
                Risk Score
              </p>
              <p
                className={`text-2xl font-bold ${
                  score >= 7
                    ? "text-emerald-600"
                    : score >= 4
                      ? "text-amber-500"
                      : "text-red-600"
                }`}
              >
                {score}/10
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Job Description */}
      <div className="bg-white border-b border-gray-200 px-6 py-3">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">
            Job Description
          </p>
          {(role === "admin" || role === "manager" || role === "supervisor") && (
            <button
              type="button"
              onClick={() => setShowJdModal(true)}
              className="flex items-center gap-1 text-[10px] text-blue-500 hover:text-blue-600"
              title="Edit job description"
            >
              <svg
                className="w-3 h-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              Edit
            </button>
          )}
        </div>
        <p
          className={`text-sm text-gray-600 leading-relaxed ${
            !showFullDescription ? "line-clamp-2" : ""
          }`}
        >
          {localJobDescription ??
            meta?.job_description ??
            "No job description available."}
        </p>
        {(localJobDescription ?? meta?.job_description) &&
          (localJobDescription ?? meta?.job_description ?? "").length > 120 && (
            <button
              type="button"
              onClick={() => setShowFullDescription(!showFullDescription)}
              className="text-xs text-blue-500 hover:text-blue-600 mt-1"
            >
              {showFullDescription ? "Show Less" : "Show More"}
            </button>
          )}
      </div>

      {showJdModal && (
        <JobDescriptionModal
          va={va}
          accessToken={accessToken}
          onClose={() => setShowJdModal(false)}
          onSaved={(desc) => {
            setLocalJobDescription(desc);
            setShowJdModal(false);
          }}
        />
      )}

      {/* Action buttons */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <svg
            className="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          Create HubSpot Ticket
        </button>
        <Link
          href={`/admin/dashboard/va/${va.vaId}`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <svg
            className="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          View in Global View
        </Link>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
        >
          <svg
            className="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
          </svg>
          Contact Incident Response
        </button>
      </div>

      {/* Stats row */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="grid grid-cols-4 gap-6">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center">
              <svg
                className="w-4 h-4 text-gray-500"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 uppercase font-medium">
                Shift Start
              </p>
              <p className="text-sm font-bold text-gray-900">
                {shiftStartDisplay}
              </p>
              {shiftStartLate && (
                <p className="text-[10px] text-red-500 font-medium flex items-center gap-0.5">
                  <svg
                    className="w-2.5 h-2.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  {shiftStartLate}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center">
              <svg
                className="w-4 h-4 text-gray-500"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 uppercase font-medium">
                Productivity
              </p>
              <p className="text-sm font-bold text-gray-900">
                {avgProductivity !== null ? `${avgProductivity}%` : "--"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center">
              <svg
                className="w-4 h-4 text-gray-500"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 uppercase font-medium">
                Avg active time
              </p>
              <p className="text-sm font-bold text-gray-900">
                {activeTimeFormatted}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center">
              <svg
                className="w-4 h-4 text-gray-500"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 00-3-3.87" />
                <path d="M16 3.13a4 4 0 010 7.75" />
              </svg>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 uppercase font-medium">
                Clients
              </p>
              <p className="text-sm font-bold text-gray-900">
                {meta?.client ?? "--"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Real-time Activity Log — admin only */}
      {role === "admin" && (
        <div className="px-6 py-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              {today === new Date().toISOString().split("T")[0]
                ? "Real-Time Activity Log"
                : `Activity Log · ${new Date(`${today}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
            </h2>
            <button
              type="button"
              onClick={fetchDailySummary}
              disabled={loadingSummary}
              className="text-xs text-blue-500 hover:text-blue-600 flex items-center gap-1"
            >
              <svg
                className={`w-3 h-3 ${loadingSummary ? "animate-spin" : ""}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              Refresh
            </button>
          </div>

          {loadingSummary ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : hourSlots.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <p className="text-sm text-gray-400">
                No activity data available yet
              </p>
            </div>
          ) : (
            <div>
              {hourSlots.map((slot) => (
                <HourActivityCard
                  key={slot.startHour}
                  slot={slot}
                  slotData={slotData[slot.startHour]}
                  isExpanded={expandedSlot === slot.startHour}
                  onToggle={() => handleSlotToggle(slot)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Work Category Analytics */}
      <VAAnalyticsSection
        vaId={va.vaId}
        date={today}
        accessToken={accessToken}
      />
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function VAMonitorView() {
  const { accessToken, user, assistantEmails, signOut } = useAuthStore();
  const role = user?.role;
  const router = useRouter();
  const [data, setData] = useState<LiveResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedVaId, setSelectedVaId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedDate, setSelectedDate] = useState<string>(
    () => new Date().toISOString().split("T")[0],
  );

  const todayStr = new Date().toISOString().split("T")[0];
  const isToday = selectedDate === todayStr;

  function shiftDate(days: number) {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + days);
    const next = d.toISOString().split("T")[0];
    if (next <= todayStr) setSelectedDate(next);
  }

  const selectedDateLabel = new Date(
    `${selectedDate}T12:00:00`,
  ).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  const dateInputRef = useRef<HTMLInputElement>(null);

  function openDatePicker() {
    const input = dateInputRef.current;
    if (!input) return;
    try {
      (input as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
    } catch {
      input.focus();
      input.click();
    }
  }

  const fetchLive = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/live`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const json: LiveResponse = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchLive();
    const id = setInterval(fetchLive, REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [fetchLive]);

  const sortedVAs = useMemo(() => {
    const allSnapshots = data?.snapshot ?? [];
    const visibleSnapshots =
      role === "admin"
        ? allSnapshots
        : allSnapshots.filter((va) => assistantEmails.includes(va.email));
    const q = search.trim().toLowerCase();
    return visibleSnapshots
      .filter((va) => {
        if (!q) return true;
        const name = displayName(va.email, va.metadata).toLowerCase();
        return (
          name.includes(q) ||
          va.email.toLowerCase().includes(q) ||
          (va.metadata?.client?.toLowerCase().includes(q) ?? false)
        );
      })
      .sort((a, b) => {
        const statusDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
        if (statusDiff !== 0) return statusDiff;
        return displayName(a.email, a.metadata).localeCompare(
          displayName(b.email, b.metadata),
        );
      });
  }, [data, search, role, assistantEmails]);

  const selectedVa = sortedVAs.find((va) => va.vaId === selectedVaId) ?? null;
  const onShiftCount = sortedVAs.filter((va) => va.status !== "idle").length;
  const supervisorName = user?.user_metadata?.name ?? user?.name ?? user?.email ?? "Admin";

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* ── Left Sidebar ──────────────────────────────────────────────── */}
      <div className="w-[400px] shrink-0 bg-white border-r border-gray-200 flex flex-col h-full">
        {/* Sidebar header */}
        <div className="px-4 py-3 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center">
                <svg
                  className="w-4 h-4 text-white"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
              <div>
                <h1 className="text-sm font-bold text-gray-900">
                  Wing Operations
                </h1>
                <p className="text-[10px] text-gray-400">
                  Supervisor: {supervisorName}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => router.back()}
                className="w-7 h-7 rounded-md flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                title="Go Back"
                aria-label="Go Back"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                type="button"
                onClick={signOut}
                className="w-7 h-7 rounded-md flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                title="Sign Out"
                aria-label="Sign Out"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Date selector */}
        <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => shiftDate(-1)}
            className="w-6 h-6 flex items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            aria-label="Previous day"
          >
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>

          <div className="flex items-center gap-2 flex-1 justify-center">
            <svg
              className="w-3 h-3 text-gray-400 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <input
              ref={dateInputRef}
              type="date"
              value={selectedDate}
              max={todayStr}
              onChange={(e) => {
                if (e.target.value && e.target.value <= todayStr) {
                  setSelectedDate(e.target.value);
                }
              }}
              style={{
                position: "absolute",
                opacity: 0,
                width: "1px",
                height: "1px",
                pointerEvents: "none",
              }}
            />
            <button
              type="button"
              onClick={openDatePicker}
              className="text-xs font-semibold text-gray-700 hover:text-blue-600 transition-colors hover:underline underline-offset-2"
            >
              {isToday ? "Today" : selectedDateLabel}
            </button>
          </div>

          <button
            type="button"
            onClick={() => shiftDate(1)}
            disabled={isToday}
            className="w-6 h-6 flex items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Next day"
          >
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>

        {/* Status counter + search */}
        <div className="px-4 py-2 border-b border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-emerald-600">
              ON SHIFT ({onShiftCount})
            </p>
          </div>
          <div className="relative">
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder="Filter VA or Client..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border border-gray-200 bg-gray-50 text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
            />
          </div>
        </div>

        {/* VA list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <p className="text-sm text-red-500 font-medium">Failed to load</p>
              <p className="text-xs text-gray-400 mt-1">{error}</p>
              <button
                type="button"
                onClick={fetchLive}
                className="mt-2 text-xs text-blue-500 hover:text-blue-600 underline"
              >
                Retry
              </button>
            </div>
          ) : sortedVAs.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <p className="text-sm text-gray-400">
                {search ? "No matching VAs found" : "No VAs available"}
              </p>
            </div>
          ) : (
            sortedVAs.map((va) => (
              <VACard
                key={va.vaId}
                va={va}
                isSelected={selectedVaId === va.vaId}
                onClick={() => setSelectedVaId(va.vaId)}
              />
            ))
          )}
        </div>
      </div>

      {/* ── Right Panel ───────────────────────────────────────────────── */}
      {selectedVa ? (
        <VADetailPanel
          va={selectedVa}
          accessToken={accessToken}
          date={selectedDate}
          role={role}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center">
            <svg
              className="w-12 h-12 text-gray-200 mx-auto mb-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 00-3-3.87" />
              <path d="M16 3.13a4 4 0 010 7.75" />
            </svg>
            <p className="text-sm text-gray-400 font-medium">
              Select a VA from the sidebar
            </p>
            <p className="text-xs text-gray-300 mt-1">
              to view real-time activity details
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
