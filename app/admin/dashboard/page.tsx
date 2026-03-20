"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useAuthStore } from "../../store/authStore";
import { convertShiftToLocalTime } from "../../lib/utils";
import { timezoneToFlag, shiftStartToUTC } from "../../lib/timezone-flags";
import VAAnalyticsSection from "../../components/VAAnalyticsSection";
import AlertsPanel from "../../components/AlertsPanel";

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
  sessionType: 'work' | 'break';
  sessionId: string | null;
  startTime: string | null;
  elapsedSeconds: number | null;
  todayWorkSeconds: number | null;
  todayBreakSeconds: number | null;
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

interface WeeklyPerformanceMetrics {
  daysLate: number;
  onTime: number;
  early: number;
  avgDelayMinutes: number | null;
  totalHours: number;
  avgProductivityScore: number | null;
}

interface DailyPerformanceMetrics {
  totalWorkSeconds: number;
  totalWorkHours: number;
  completedWorkSeconds: number;
  liveWorkSeconds: number;
  completedBreakSeconds: number;
  avgProductivityScore: number | null;
  screenshotCount: number;
}

interface DailyLiveSession {
  sessionId: string;
  status: string;
  sessionType: string;
  startTime: string;
  currentDurationSeconds: number;
  idleSeconds: number;
}

interface DailyPunctuality {
  status: "on_time" | "late" | "early" | "no_session";
  delayMinutes: number | null;
  firstSessionStart: string | null;
  shiftStart: string | null;
}

interface DailyPerformanceResponse {
  vaId: string;
  date: string;
  metrics: DailyPerformanceMetrics;
  liveSession: DailyLiveSession | null;
  punctuality: DailyPunctuality;
  meta: { timezone: string; shiftAvailable: boolean; generatedAt: string };
}

interface AssignedClient {
  id: string;
  biz_id: string;
  business_name: string;
}

interface OpsDetails {
  user: Record<string, unknown> & { staff_id?: string | number };
  assigned_clients: AssignedClient[];
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

function getInitials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
}

function getAvatarColor(name: string): string {
  const colors = [
    "bg-blue-500",
    "bg-purple-500",
    "bg-emerald-500",
    "bg-rose-500",
    "bg-cyan-600",
    "bg-indigo-500",
    "bg-teal-500",
    "bg-pink-500",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function formatSecondsToReadableTimeFormat(seconds: number | null): string {
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
  const productivity = va.sessionType === 'work'
    ? (va.todayWorkSeconds ?? 0 - va.idleSeconds) / (va.todayWorkSeconds ?? 0)
    : (va.todayBreakSeconds ?? 0 - va.idleSeconds) / (va.todayBreakSeconds ?? 0)

  if (va.status === "idle") {
    return { label: "Offline", className: "bg-gray-100 text-gray-500" };
  }
  if (va.status === "suspended") {
    return {
      label: "Attention",
      className: "bg-amber-400 text-white",
    };
  }
  if (productivity < 0.4 && va.todayWorkSeconds && va.todayWorkSeconds > 1800) {
    return { label: "Intervention", className: "bg-red-500 text-white" };
  }
  if (productivity < 0.6 && va.todayWorkSeconds && va.todayWorkSeconds > 1800) {
    return { label: "At Risk", className: "bg-orange-500 text-white" };
  }
  return {
    label: "On Track",
    className: "bg-emerald-100 text-emerald-700 border border-emerald-200",
  };
}

function getRiskScore(va: VASnapshot): number {
  if (!va.todayWorkSeconds || va.todayWorkSeconds === 0) return 0;
  const activeRatio =
    (va.todayWorkSeconds - va.idleSeconds) / va.todayWorkSeconds;
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

function computeStartDiff(va: VASnapshot): number | null {
  if (!va.startTime || !va.metadata?.shift_start_time) return null;
  const tzAbbr = va.metadata.shift_time_zone ?? "UTC";
  const shiftDate = shiftStartToUTC(va.metadata.shift_start_time, tzAbbr);
  const actualStart = new Date(va.startTime);
  return Math.round((actualStart.getTime() - shiftDate.getTime()) / 60000);
}

function isNeedsAttention(badge: { label: string }): boolean {
  return ["Intervention", "At Risk", "Attention"].includes(badge.label);
}

const STATUS_ORDER: Record<VAStatus, number> = {
  active: 0,
  suspended: 1,
  idle: 2,
};

const REFRESH_INTERVAL = 30_000;
const DAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ── Week Date Picker ────────────────────────────────────────────────────────

function getWeekDays(dateStr: string): string[] {
  const date = new Date(`${dateStr}T12:00:00`);
  const day = date.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + diffToMonday);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.toISOString().split("T")[0];
  });
}

function WeekDatePicker({
  selectedDate,
  onChange,
}: {
  selectedDate: string;
  onChange: (date: string) => void;
}) {
  const todayStr = new Date().toISOString().split("T")[0];
  const weekDays = getWeekDays(selectedDate);

  function shiftWeek(dir: -1 | 1) {
    const newMonday = new Date(`${weekDays[0]}T12:00:00`);
    newMonday.setDate(newMonday.getDate() + dir * 7);
    const newStr = newMonday.toISOString().split("T")[0];
    if (dir === 1 && newStr > todayStr) return;
    onChange(newStr);
  }

  const monthLabel = new Date(`${selectedDate}T12:00:00`).toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric", year: "numeric" },
  );

  return (
    <div className="flex items-center justify-between px-6 py-3 border-b border-gray-100 bg-white">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => shiftWeek(-1)}
          className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:bg-gray-100 transition-colors"
          aria-label="Previous week"
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
        <div className="flex items-center">
          {weekDays.map((day, i) => {
            const d = new Date(`${day}T12:00:00`);
            const dayNum = d.getDate();
            const isSelected = day === selectedDate;
            const isToday = day === todayStr;
            const isFuture = day > todayStr;
            return (
              <button
                key={day}
                type="button"
                onClick={() => !isFuture && onChange(day)}
                disabled={isFuture}
                className={`flex flex-col items-center gap-0.5 w-11 py-1.5 rounded-xl transition-colors ${
                  isSelected
                    ? "bg-blue-600"
                    : isFuture
                      ? "opacity-30 cursor-not-allowed"
                      : "hover:bg-gray-100 cursor-pointer"
                }`}
              >
                <span
                  className={`text-[10px] font-medium ${isSelected ? "text-blue-200" : "text-gray-400"}`}
                >
                  {DAY_ABBR[i]}
                </span>
                <span
                  className={`text-sm font-semibold ${isSelected ? "text-white" : "text-gray-800"}`}
                >
                  {dayNum}
                </span>
                <span
                  className={`w-1 h-1 rounded-full ${
                    isToday
                      ? isSelected
                        ? "bg-blue-300"
                        : "bg-blue-500"
                      : "bg-transparent"
                  }`}
                />
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => shiftWeek(1)}
          disabled={weekDays[6] >= todayStr}
          className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:bg-gray-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Next week"
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
      <span className="text-xs font-medium text-gray-500">{monthLabel}</span>
    </div>
  );
}

// ── Performance Overview ────────────────────────────────────────────────────

function PerformanceOverview({
  weeklyMetrics,
  loading,
}: {
  weeklyMetrics: WeeklyPerformanceMetrics | null;
  loading: boolean;
}) {
  const [expanded, setExpanded] = useState(true);

  const fmt = (n: number | null, suffix = "") =>
    n !== null ? `${n}${suffix}` : null;

  const metrics: Array<{
    value: string | null;
    label: string;
    valueClass: string;
  }> = [
    { value: fmt(weeklyMetrics?.daysLate ?? null), label: "DAYS LATE", valueClass: "text-red-500" },
    { value: fmt(weeklyMetrics?.onTime ?? null), label: "ON TIME", valueClass: "text-emerald-500" },
    { value: fmt(weeklyMetrics?.early ?? null), label: "EARLY", valueClass: "text-gray-800" },
    {
      value: weeklyMetrics?.avgDelayMinutes != null ? `${weeklyMetrics.avgDelayMinutes}m` : null,
      label: "AVG DELAY",
      valueClass: "text-gray-800",
    },
    {
      value: weeklyMetrics?.totalHours != null ? `${weeklyMetrics.totalHours}h` : null,
      label: "TOTAL HOURS",
      valueClass: "text-gray-800",
    },
    {
      value: weeklyMetrics?.avgProductivityScore != null ? `${weeklyMetrics.avgProductivityScore}%` : null,
      label: "PRODUCTIVITY",
      valueClass: "text-blue-600",
    },
  ];

  return (
    <div className="mx-6 my-4 border border-gray-200 rounded-xl overflow-hidden bg-white">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4 text-gray-500"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
            <polyline points="16 7 22 7 22 13" />
          </svg>
          <span className="text-sm font-semibold text-gray-800">
            Performance Overview
          </span>
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? "" : "rotate-180"}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M18 15l-6-6-6 6" />
        </svg>
      </button>
      {expanded && (
        <div className="grid grid-cols-6 border-t border-gray-100">
          {metrics.map((m, i) => (
            <div
              key={m.label}
              className={`flex flex-col items-center justify-center py-5 px-2 ${i > 0 ? "border-l border-gray-100" : ""}`}
            >
              {loading ? (
                <div className="h-7 w-10 bg-gray-100 rounded animate-pulse mb-1" />
              ) : (
                <span className={`text-2xl font-bold ${m.value ? m.valueClass : "text-gray-300"}`}>
                  {m.value ?? "--"}
                </span>
              )}
              <span className="text-[10px] text-gray-400 uppercase font-medium mt-1 text-center leading-tight">
                {m.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Daily Performance Overview ──────────────────────────────────────────────

function DailyPerformanceOverview({
  metrics,
  punctuality,
  liveSession,
  loading,
  date,
}: {
  metrics: DailyPerformanceMetrics | null;
  punctuality: DailyPunctuality | null;
  liveSession: DailyLiveSession | null;
  loading: boolean;
  date: string;
}) {
  const [expanded, setExpanded] = useState(true);

  const isToday = date === new Date().toISOString().split("T")[0];
  const isLive = liveSession?.status === "active";

  const punctualityDisplay = () => {
    if (!punctuality || punctuality.status === "no_session") return null;
    if (punctuality.status === "late" && punctuality.delayMinutes !== null)
      return `+${punctuality.delayMinutes}m`;
    if (punctuality.status === "early" && punctuality.delayMinutes !== null)
      return `${punctuality.delayMinutes}m`;
    return "On Time";
  };

  const punctualityClass = () => {
    if (!punctuality || punctuality.status === "no_session") return "text-gray-300";
    if (punctuality.status === "late") return "text-red-500";
    if (punctuality.status === "early") return "text-blue-500";
    return "text-emerald-500";
  };

  const cols: Array<{
    value: string | null;
    label: string;
    valueClass: string;
    dot?: string;
  }> = [
    {
      value: metrics?.totalWorkHours != null ? `${metrics.totalWorkHours}h` : null,
      label: "HOURS TODAY",
      valueClass: "text-gray-800",
    },
    {
      value: metrics ? formatSecondsToReadableTimeFormat(metrics.completedBreakSeconds) : null,
      label: "BREAK TIME",
      valueClass: "text-gray-800",
    },
    {
      value: isLive && liveSession
        ? formatSecondsToReadableTimeFormat(liveSession.currentDurationSeconds)
        : metrics?.liveWorkSeconds
          ? formatSecondsToReadableTimeFormat(metrics.liveWorkSeconds)
          : null,
      label: isLive ? "LIVE NOW" : "LIVE SESSION",
      valueClass: isLive ? "text-emerald-500" : "text-gray-400",
      dot: isLive ? "emerald" : undefined,
    },
    {
      value: metrics?.screenshotCount != null ? String(metrics.screenshotCount) : null,
      label: "SCREENSHOTS",
      valueClass: "text-gray-800",
    },
    {
      value: punctualityDisplay(),
      label: "PUNCTUALITY",
      valueClass: punctualityClass(),
    },
    {
      value: metrics?.avgProductivityScore != null ? `${metrics.avgProductivityScore}%` : null,
      label: "PRODUCTIVITY",
      valueClass: "text-blue-600",
    },
  ];

  const dateLabel = new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="mx-6 mb-4 border border-gray-200 rounded-xl overflow-hidden bg-white">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
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
          <span className="text-sm font-semibold text-gray-800">
            Daily Overview
          </span>
          <span className="text-xs text-gray-400 font-normal">— {dateLabel}</span>
          {isToday && isLive && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              LIVE
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? "" : "rotate-180"}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M18 15l-6-6-6 6" />
        </svg>
      </button>

      {expanded && (
        <div className="grid grid-cols-6 border-t border-gray-100">
          {cols.map((m, i) => (
            <div
              key={m.label}
              className={`flex flex-col items-center justify-center py-5 px-2 ${i > 0 ? "border-l border-gray-100" : ""}`}
            >
              {loading ? (
                <div className="h-7 w-10 bg-gray-100 rounded animate-pulse mb-1" />
              ) : (
                <div className="flex items-center gap-1">
                  {m.dot === "emerald" && (
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                  )}
                  <span className={`text-2xl font-bold ${m.value ? m.valueClass : "text-gray-300"}`}>
                    {m.value ?? "--"}
                  </span>
                </div>
              )}
              <span className="text-[10px] text-gray-400 uppercase font-medium mt-1 text-center leading-tight">
                {m.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Invite Modal ────────────────────────────────────────────────────────────

function InviteModal({ accessToken, onClose }: { accessToken: string | null; onClose: () => void }) {
  const [emails, setEmails] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fetching, setFetching] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<InviteResult[] | null>(null);

  const fetchUnregistered = useCallback(async () => {
    setFetching(true);
    setFetchError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/invite/unregistered`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const json: { data: { unregistered: string[] } } = await res.json();
      setEmails(json.data.unregistered);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Failed to fetch");
    } finally {
      setFetching(false);
    }
  }, [accessToken]);

  useEffect(() => { fetchUnregistered(); }, [fetchUnregistered]);

  const toggleAll = () => {
    setSelected(selected.size === emails.length ? new Set() : new Set(emails));
  };

  const toggleOne = (email: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email); else next.add(email);
      return next;
    });
  };

  const handleSend = async () => {
    if (selected.size === 0) return;
    setSending(true);
    setResults(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/invite/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ emails: Array.from(selected) }),
      });
      const json: { data: { results: InviteResult[] } } = await res.json();
      setResults(json.data.results);
      const succeeded = new Set(json.data.results.filter((r) => r.success).map((r) => r.email));
      setEmails((prev) => prev.filter((e) => !succeeded.has(e)));
      setSelected((prev) => { const next = new Set(prev); succeeded.forEach((e) => next.delete(e)); return next; });
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Failed to send invites");
    } finally {
      setSending(false);
    }
  };

  const allSelected = emails.length > 0 && selected.size === emails.length;
  const someSelected = selected.size > 0 && selected.size < emails.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md flex flex-col max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Invite Team Members</h2>
            <p className="text-xs text-gray-400 mt-0.5">Assistants assigned to you who haven&apos;t joined yet</p>
          </div>
          <button type="button" onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-md text-gray-400 hover:bg-gray-100">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {fetchError && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 mb-3">
              <svg className="w-3.5 h-3.5 text-red-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
              <p className="text-xs text-red-600 flex-1">{fetchError}</p>
              <button type="button" onClick={fetchUnregistered} className="text-xs text-red-500 hover:text-red-600 underline shrink-0">Retry</button>
            </div>
          )}

          {results && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 mb-3">
              <p className="text-xs text-emerald-700 font-medium">
                {results.filter((r) => r.success).length} invite(s) sent successfully
                {results.filter((r) => !r.success).length > 0 && (
                  <span className="text-red-600 ml-1">· {results.filter((r) => !r.success).length} failed</span>
                )}
              </p>
            </div>
          )}

          {fetching ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : emails.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <svg className="w-8 h-8 text-gray-200 mb-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <p className="text-sm text-gray-400">All team members have joined</p>
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="px-3 py-2.5 w-10">
                      <input type="checkbox" checked={allSelected} ref={(el) => { if (el) el.indeterminate = someSelected; }} onChange={toggleAll} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                    </th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Email</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {emails.map((email) => {
                    const result = results?.find((r) => r.email === email);
                    return (
                      <tr key={email} className={`cursor-pointer hover:bg-gray-50/60 transition-colors ${selected.has(email) ? "bg-blue-50/40" : ""}`} onClick={() => toggleOne(email)}>
                        <td className="px-3 py-2.5">
                          <span onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={selected.has(email)} onChange={() => toggleOne(email)} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-gray-700">{email}</td>
                        <td className="px-3 py-2.5">
                          {result ? (
                            result.success
                              ? <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700">Invited</span>
                              : <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-600">Failed</span>
                          ) : (
                            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500">Not joined</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        {!fetching && emails.length > 0 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 shrink-0">
            <p className="text-xs text-gray-400">
              {selected.size > 0 ? `${selected.size} of ${emails.length} selected` : `${emails.length} not yet joined`}
            </p>
            <div className="flex items-center gap-2">
              {selected.size > 0 && (
                <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-gray-400 hover:text-gray-600">Clear</button>
              )}
              <button
                type="button"
                onClick={handleSend}
                disabled={selected.size === 0 || sending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? (
                  <><span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />Sending…</>
                ) : (
                  <><svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13" /><path d="M22 2L15 22l-4-9-9-4 20-7z" /></svg>Send Invite{selected.size > 1 ? "s" : ""}{selected.size > 0 ? ` (${selected.size})` : ""}</>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Invite Section ──────────────────────────────────────────────────────────

interface InviteResult {
  email: string;
  success: boolean;
  error?: string;
}

function InviteSection({ accessToken }: { accessToken: string | null }) {
  const [open, setOpen] = useState(false);
  const [emails, setEmails] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<InviteResult[] | null>(null);
  const hasFetched = useRef(false);

  const fetchUnregistered = useCallback(async () => {
    setFetching(true);
    setFetchError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/invite/unregistered`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const json: { data: { unregistered: string[] } } = await res.json();
      setEmails(json.data.unregistered);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Failed to fetch");
    } finally {
      setFetching(false);
    }
  }, [accessToken]);

  const handleToggle = () => {
    setOpen((prev) => {
      if (!prev && !hasFetched.current) {
        hasFetched.current = true;
        fetchUnregistered();
      }
      return !prev;
    });
  };

  const toggleAll = () => {
    if (selected.size === emails.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(emails));
    }
  };

  const toggleOne = (email: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  };

  const handleSendInvites = async () => {
    if (selected.size === 0) return;
    setSending(true);
    setResults(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/invite/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ emails: Array.from(selected) }),
      });
      const json: { data: { results: InviteResult[] } } = await res.json();
      setResults(json.data.results);
      const succeeded = new Set(
        json.data.results.filter((r) => r.success).map((r) => r.email),
      );
      setEmails((prev) => prev.filter((e) => !succeeded.has(e)));
      setSelected((prev) => {
        const next = new Set(prev);
        succeeded.forEach((e) => next.delete(e));
        return next;
      });
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Failed to send invites");
    } finally {
      setSending(false);
    }
  };

  const allSelected = emails.length > 0 && selected.size === emails.length;
  const someSelected = selected.size > 0 && selected.size < emails.length;

  return (
    <div className="border-t border-gray-100 bg-white shrink-0">
      <button
        type="button"
        onClick={handleToggle}
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50/50 transition-colors"
      >
        <div>
          <h2 className="text-xs font-semibold text-gray-800">
            Invite Team Members
          </h2>
          <p className="text-[11px] text-gray-400 mt-0.5">
            Assistants who haven&apos;t joined yet
          </p>
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="px-3 pb-3">
          {fetchError && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 mb-3">
              <svg
                className="w-3.5 h-3.5 text-red-500 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
              <p className="text-xs text-red-600 flex-1">{fetchError}</p>
              <button
                type="button"
                onClick={fetchUnregistered}
                className="text-xs text-red-500 hover:text-red-600 underline shrink-0"
              >
                Retry
              </button>
            </div>
          )}

          {results && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 mb-3">
              <p className="text-xs text-emerald-700 font-medium">
                {results.filter((r) => r.success).length} invite(s) sent
                successfully
                {results.filter((r) => !r.success).length > 0 && (
                  <span className="text-red-600 ml-1">
                    · {results.filter((r) => !r.success).length} failed
                  </span>
                )}
              </p>
            </div>
          )}

          {fetching ? (
            <div className="flex items-center justify-center py-6">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : emails.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <svg
                className="w-7 h-7 text-gray-200 mb-1.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <p className="text-xs text-gray-400">All team members have joined</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] text-gray-400">
                  {selected.size > 0
                    ? `${selected.size} of ${emails.length} selected`
                    : `${emails.length} not yet joined`}
                </p>
                <div className="flex items-center gap-2">
                  {selected.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelected(new Set())}
                      className="text-[11px] text-gray-400 hover:text-gray-600"
                    >
                      Clear
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleSendInvites}
                    disabled={selected.size === 0 || sending}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {sending ? (
                      <>
                        <span className="w-2.5 h-2.5 border border-white border-t-transparent rounded-full animate-spin" />
                        Sending…
                      </>
                    ) : (
                      <>
                        <svg
                          className="w-3 h-3"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M22 2L11 13" />
                          <path d="M22 2L15 22l-4-9-9-4 20-7z" />
                        </svg>
                        Send{selected.size > 0 ? ` (${selected.size})` : ""}
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="px-2.5 py-2 w-8">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = someSelected;
                          }}
                          onChange={toggleAll}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </th>
                      <th className="px-2.5 py-2 text-left font-semibold text-gray-400 uppercase tracking-wide">
                        Email
                      </th>
                      <th className="px-2.5 py-2 text-left font-semibold text-gray-400 uppercase tracking-wide">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {emails.map((email) => {
                      const result = results?.find((r) => r.email === email);
                      return (
                        <tr
                          key={email}
                          className={`cursor-pointer hover:bg-gray-50/60 transition-colors ${
                            selected.has(email) ? "bg-blue-50/40" : ""
                          }`}
                          onClick={() => toggleOne(email)}
                        >
                          <td className="px-2.5 py-2">
                            <span onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={selected.has(email)}
                                onChange={() => toggleOne(email)}
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                            </span>
                          </td>
                          <td className="px-2.5 py-2 text-gray-700 truncate max-w-[140px]">
                            {email}
                          </td>
                          <td className="px-2.5 py-2">
                            {result ? (
                              result.success ? (
                                <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-emerald-100 text-emerald-700">
                                  Invited
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-red-100 text-red-600">
                                  Failed
                                </span>
                              )
                            ) : (
                              <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-500">
                                Pending
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Top Header ──────────────────────────────────────────────────────────────

function TopHeader({
  supervisorName,
  role,
  activeCount,
  flaggedCount,
  offlineCount,
  onSignOut,
  onSendInvitations,
}: {
  supervisorName: string;
  role: string | undefined;
  activeCount: number;
  flaggedCount: number;
  offlineCount: number;
  onSignOut: () => void;
  onSendInvitations: () => void;
}) {
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);

  return (
    <div className="h-12 bg-white border-b border-gray-200 flex items-center justify-between px-5 shrink-0 z-10">
      <div className="flex items-center gap-3">
        <span className="text-base font-bold text-gray-900 tracking-tight">
          WingWatch
        </span>
        <span className="text-sm text-gray-400">
          {role ? role.charAt(0).toUpperCase() + role.slice(1) : "User"}: {supervisorName}
        </span>
      </div>

      <div className="flex items-center gap-3">
        {/* Status pills */}
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            {activeCount} Active
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 border border-gray-200 rounded-full px-2.5 py-0.5">
            <svg
              className="w-3 h-3 text-amber-500"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            {flaggedCount} Flagged
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500">
            <span className="w-2 h-2 rounded-full bg-gray-300" />
            {offlineCount} Offline
          </span>
        </div>

        <div className="w-px h-4 bg-gray-200" />

        {/* Alerts */}
        <AlertsPanel />

        <div className="w-px h-4 bg-gray-200" />

        {/* Send Invitations */}
        <button
          type="button"
          onClick={onSendInvitations}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <svg
            className="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
          </svg>
          Send Invitation Emails
        </button>

        {/* Sign Out */}
        <button
          type="button"
          onClick={() => setConfirmingSignOut(true)}
          className="w-7 h-7 flex items-center justify-center rounded-md text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
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
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>

      {/* Sign-out confirmation dialog */}
      {confirmingSignOut && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setConfirmingSignOut(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-sm font-semibold text-gray-900 mb-1">Sign out?</h2>
            <p className="text-xs text-gray-400 mb-5">You will be returned to the login screen.</p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmingSignOut(false)}
                className="px-3 py-1.5 text-xs font-medium text-gray-600 rounded-lg border border-gray-200 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { setConfirmingSignOut(false); onSignOut(); }}
                className="px-3 py-1.5 text-xs font-medium text-white bg-red-500 rounded-lg hover:bg-red-600"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── VA Sidebar Card ─────────────────────────────────────────────────────────

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
  const avatarBg = getAvatarColor(name);
  const initials = getInitials(name);
  const diffMin = computeStartDiff(va);
  const needsAttn = isNeedsAttention(badge);

  const shiftStart = meta?.shift_start_time ?? "";
  const shiftEnd = meta?.shift_end_time ?? "";
  const shiftTZ = meta?.shift_time_zone ?? "";

  let endTimeDisplay = "--";
  let startTimeDisplay = "--";
  if (shiftEnd && shiftStart && shiftTZ) {
      const local = convertShiftToLocalTime({
        shift_start_time: shiftStart,
        shift_end_time: shiftEnd,
        shift_time_zone: shiftTZ,
      });
      endTimeDisplay = local.localEndTime;
      startTimeDisplay = local.localStartTime;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-3 transition-colors border-b border-gray-100 ${
        isSelected
          ? "bg-blue-50 border-l-2 border-l-blue-500"
          : "hover:bg-gray-50 border-l-2 border-l-transparent"
      }`}
    >
      {/* Row 1: Avatar + Name + Badge */}
      <div className="flex items-start justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative shrink-0">
            <div
              className={`w-9 h-9 rounded-full ${avatarBg} flex items-center justify-center`}
            >
              <span className="text-xs font-bold text-white">{initials}</span>
            </div>
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${
                va.status === "active"
                  ? "bg-emerald-500"
                  : va.status === "suspended"
                    ? "bg-amber-400"
                    : "bg-gray-300"
              }`}
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <span className="text-sm font-semibold text-gray-900 truncate">
                {name}
              </span>
              {timezoneToFlag(shiftTZ) && (
                <span className="text-sm shrink-0" title={shiftTZ}>{timezoneToFlag(shiftTZ)}</span>
              )}
              {needsAttn && (
                <svg
                  className="w-3 h-3 text-amber-500 shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              )}
            </div>
            <p className="text-[11px] text-gray-400 truncate">
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
          <span className="text-[11px] font-semibold text-gray-500">
            {score}/10
          </span>
        </div>
      </div>

      {/* Row 2: CLIENT / START / BREAK / ENDS */}
      <div className="grid grid-cols-4 gap-1 text-[10px]">
        <div>
          <p className="text-gray-400 uppercase font-medium mb-0.5">Client</p>
          <p className="text-gray-700 font-medium truncate">
            {meta?.client ?? "--"}
          </p>
        </div>
        <div>
          <p className="text-gray-400 uppercase font-medium mb-0.5">Start</p>
          <p className="text-gray-700 font-medium">{startTimeDisplay}</p>
          {/* //TODO: Add back in when we have the API to get the diffMin */}
          {/* {diffMin !== null && diffMin > 5 && (
            <p className="text-red-500 font-semibold text-[9px]">
              Late +{diffMin}m
            </p>
          )}
          {diffMin !== null && diffMin < -5 && (
            <p className="text-emerald-500 font-semibold text-[9px]">
              Early {Math.abs(diffMin)}m
            </p>
          )}
          {diffMin !== null &&
            Math.abs(diffMin) <= 5 &&
            va.status === "active" && (
              <p className="text-emerald-500 font-semibold text-[9px]">
                On Time
              </p>
            )} */}
        </div>
        <div>
          <p className="text-gray-400 uppercase font-medium mb-0.5">Break</p>
          <p className="text-gray-700 font-medium">
            {formatSecondsToReadableTimeFormat(va.todayBreakSeconds)}
          </p>
        </div>
        <div>
          <p className="text-gray-400 uppercase font-medium mb-0.5">Ends</p>
          <p className="text-gray-700 font-medium">{endTimeDisplay}</p>
          {/* <p className="text-red-500 font-medium">{va.lastSeenAt ? formatISOTime(va.lastSeenAt) : "--"}</p> */}
        </div>
      </div>
    </button>
  );
}

// ── Hour Activity Card ──────────────────────────────────────────────────────

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
                    {slot.startLabel} – {slot.endLabel}
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
                {isExpanded ? "HIDE" : "DETAILS"}
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
                    : "Click DETAILS to load activity data."}
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

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {screenshots.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setLightbox(s)}
                    className="group relative rounded-lg overflow-hidden bg-gray-100 aspect-video hover:ring-2 hover:ring-blue-400 transition-all"
                  >
                    {s.presignedUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={s.presignedUrl}
                        alt="Screenshot"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg
                          className="w-6 h-6 text-gray-400"
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
                        className={`absolute bottom-1 right-1 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                          s.productivityScore >= 70
                            ? "bg-emerald-500 text-white"
                            : s.productivityScore >= 40
                              ? "bg-amber-400 text-white"
                              : "bg-red-500 text-white"
                        }`}
                      >
                        {s.productivityScore}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isExpanded && isLoaded && screenshots.length === 0 && (
            <div className="border-t border-gray-100 px-4 py-6 flex items-center justify-center">
              <p className="text-xs text-gray-400">
                No screenshots captured in this window.
              </p>
            </div>
          )}
        </div>
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
        >
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

// ── Role Responsibilities Modal ─────────────────────────────────────────────

function RoleResponsibilitiesModal({
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900">
            Role Responsibilities —{" "}
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
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400 placeholder:text-gray-300 text-gray-900"
                  />
                </div>
                <div>
                  <label
                    className="block text-xs font-medium text-gray-600 mb-1"
                    htmlFor="jd-description"
                  >
                    Description <span className="text-gray-400 font-normal">(min 10 characters)</span><span className="text-red-400">{" "}*</span>
                  </label>
                  <textarea
                    id="jd-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={6}
                    maxLength={5000}
                    placeholder="Describe the VA's responsibilities, tools used, and what productive work looks like…"
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400 placeholder:text-gray-300 resize-none text-gray-900"
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
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Right Panel: VA Detail ──────────────────────────────────────────────────

function VADetailPanel({
  va,
  accessToken,
  date,
  role,
  onDateChange,
}: {
  va: VASnapshot;
  accessToken: string | null;
  date: string;
  role: string | undefined;
  onDateChange: (date: string) => void;
}) {
  const [dailySummary, setDailySummary] = useState<DailySummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [weeklyMetrics, setWeeklyMetrics] = useState<WeeklyPerformanceMetrics | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState(true);
  const [dailyPerfData, setDailyPerfData] = useState<DailyPerformanceResponse | null>(null);
  const [loadingDailyMetrics, setLoadingDailyMetrics] = useState(true);
  const [slotData, setSlotData] = useState<Record<number, SlotData>>({});
  const [expandedSlot, setExpandedSlot] = useState<number | null>(null);
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [localJobDescription, setLocalJobDescription] = useState<string | null>(null);
  const [opsDetails, setOpsDetails] = useState<OpsDetails | null>(null);

  useEffect(() => {
    if (!va.email || !accessToken) return;
    fetch(`${API_BASE_URL}/api/users/ops-details?email=${encodeURIComponent(va.email)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setOpsDetails(data?.data ?? null))
      .catch(() => {});
  }, [va.email, accessToken]);

  const meta = va.metadata;
  const name = displayName(va.email, meta);
  const badge = getStatusBadge(va);
  const score = getRiskScore(va);
  const today = date;
  const timezone = meta?.shift_time_zone ?? "UTC";
  const avatarBg = getAvatarColor(name);
  const initials = getInitials(name);
  const needsAttn = isNeedsAttention(badge);

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

  // Client schedule pill
  let clientSchedule: { name: string; start: string; end: string } | null = null;
  if (meta?.client && meta?.shift_start_time && meta?.shift_end_time) {
    clientSchedule = {
      name: meta.client,
      start: meta.shift_start_time,
      end: meta.shift_end_time,
    };
  }

  const fetchDailySummary = useCallback(async (silent = false) => {
    if (!silent) setLoadingSummary(true);
    try {
      const url = `${API_BASE_URL}/admin/screenshots/daily-summary?va_id=${va.vaId}&date=${today}&timezone=${encodeURIComponent(timezone)}`;
      const res = await fetch(url, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const json: DailySummary = await res.json();
      setDailySummary(json);
      if (!silent) {
        setSlotData({});
        setExpandedSlot(null);
      }
    } catch {
      if (!silent) setDailySummary(null);
    } finally {
      if (!silent) setLoadingSummary(false);
    }
  }, [va.vaId, today, accessToken, timezone]);

  useEffect(() => {
    fetchDailySummary(false);
    const id = setInterval(() => fetchDailySummary(true), REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [fetchDailySummary]);

  const weekStart = getWeekDays(today)[0];

  const fetchWeeklyMetrics = useCallback(async (silent = false) => {
    if (!va.vaId || !accessToken) return;
    if (!silent) setLoadingMetrics(true);
    try {
      const r = await fetch(`${API_BASE_URL}/admin/performance?vaId=${va.vaId}&weekStart=${weekStart}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = r.ok ? await r.json() : null;
      setWeeklyMetrics(data?.metrics ?? null);
    } catch {
      if (!silent) setWeeklyMetrics(null);
    } finally {
      if (!silent) setLoadingMetrics(false);
    }
  }, [va.vaId, weekStart, accessToken]);

  useEffect(() => {
    fetchWeeklyMetrics(false);
    const id = setInterval(() => fetchWeeklyMetrics(true), REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [fetchWeeklyMetrics]);

  const fetchDailyMetrics = useCallback(async (silent = false) => {
    if (!va.vaId || !accessToken) return;
    if (!silent) setLoadingDailyMetrics(true);
    try {
      const r = await fetch(`${API_BASE_URL}/admin/performance/daily?vaId=${va.vaId}&date=${today}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data: DailyPerformanceResponse | null = r.ok ? await r.json() : null;
      setDailyPerfData(data);
    } catch {
      if (!silent) setDailyPerfData(null);
    } finally {
      if (!silent) setLoadingDailyMetrics(false);
    }
  }, [va.vaId, today, accessToken]);

  useEffect(() => {
    fetchDailyMetrics(false);
    const id = setInterval(() => fetchDailyMetrics(true), REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [fetchDailyMetrics]);

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

  const activityLogLabel = new Date(`${today}T12:00:00`)
    .toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    })
    .toUpperCase();

  return (
    <div className="flex-1 min-w-0 overflow-y-auto bg-gray-50">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          {/* Left: Avatar + Name + Badges */}
          <div className="flex items-start gap-3 min-w-0">
            <div className="relative shrink-0">
              <div
                className={`w-12 h-12 rounded-full ${avatarBg} flex items-center justify-center`}
              >
                <span className="text-base font-bold text-white">
                  {initials}
                </span>
              </div>
              {va.status === "active" && (
                <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-white" />
              )}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5 mb-1.5">
                <h1 className="text-xl font-bold text-gray-900">{name}</h1>
                {timezoneToFlag(timezone) && (
                  <span className="text-base" title={timezone}>{timezoneToFlag(timezone)}</span>
                )}
                {needsAttn && (
                  <svg
                    className="w-4 h-4 text-amber-500 shrink-0"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {meta?.role && (
                  <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                    {meta.role}
                  </span>
                )}
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    va.status === "active"
                      ? "bg-emerald-100 text-emerald-700"
                      : va.status === "suspended"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {va.status === "active"
                    ? "Active"
                    : va.status === "suspended"
                      ? "Suspended"
                      : "Offline"}
                </span>
                {needsAttn && (
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                )}
                <span className="text-sm font-bold text-gray-700">
                  {score}/10
                </span>
                <span className="text-gray-200 mx-0.5">·</span>
                <span className="text-xs text-gray-400">{localTime} Local</span>
                <span className="text-xs text-gray-400">{estTime} EST</span>
                <span className="text-xs text-gray-400">{pstTime} PST</span>
              </div>
            </div>
          </div>

          {/* Right: Buttons + Client Schedule */}
          <div className="flex flex-col items-end gap-2 shrink-0">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  window.open("https://tickets.wingcsm.com/", "_blank")
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <svg
                  className="w-3.5 h-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                Create Hubspot Ticket
              </button>
              <Link
                href={`https://employee.getwingapp.com/staffing-resource/viewprofile/${opsDetails?.user?.staff_id ?? ""}`}
                target="_blank"
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
                Global View
              </Link>
            </div>

            {clientSchedule && (
              <div className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                {clientSchedule.name}
                <span className="text-blue-400 font-normal ml-1">
                  {clientSchedule.start} – {clientSchedule.end}
                </span>
              </div>
            )}
            {opsDetails && opsDetails.assigned_clients.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {opsDetails.assigned_clients.map((c) => (
                  <span
                    key={c.id}
                    className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-700"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />
                    {c.business_name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Week Date Picker ─────────────────────────────────────────── */}
      <WeekDatePicker selectedDate={date} onChange={onDateChange} />

      {/* ── Performance Overview ─────────────────────────────────────── */}
      <PerformanceOverview weeklyMetrics={weeklyMetrics} loading={loadingMetrics} />

      {/* ── Daily Performance Overview ───────────────────────────────── */}
      <DailyPerformanceOverview
        metrics={dailyPerfData?.metrics ?? null}
        punctuality={dailyPerfData?.punctuality ?? null}
        liveSession={dailyPerfData?.liveSession ?? null}
        loading={loadingDailyMetrics}
        date={today}
      />

      {/* ── Role Responsibilities ────────────────────────────────────── */}
      <div className="mx-6 mb-4 border border-gray-200 rounded-xl overflow-hidden bg-white">
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-2">
            <svg
              className="w-4 h-4 text-gray-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="2" y="7" width="20" height="14" rx="2" />
              <path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16" />
            </svg>
            <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
              Role Responsibilities
            </span>
            <svg
              className="w-3.5 h-3.5 text-gray-300"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
          {(role === "admin" || role === "manager" || role === "supervisor") && (
            <button
              type="button"
              onClick={() => setShowRoleModal(true)}
              className="w-7 h-7 flex items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 transition-colors"
              title="Edit role responsibilities"
            >
              <svg
                className="w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          )}
        </div>
        <div className="px-5 pb-4">
          <p
            className={`text-sm text-gray-600 leading-relaxed ${
              !showFullDescription ? "line-clamp-2" : ""
            }`}
          >
            {localJobDescription ??
              meta?.job_description ??
              "No role responsibilities defined."}
          </p>
          {(localJobDescription ?? meta?.job_description) &&
            (localJobDescription ?? meta?.job_description ?? "").length >
              120 && (
              <button
                type="button"
                onClick={() => setShowFullDescription(!showFullDescription)}
                className="text-xs text-blue-500 hover:text-blue-600 mt-1"
              >
                {showFullDescription ? "Show Less" : "Show More"}
              </button>
            )}
        </div>
      </div>

      {showRoleModal && (
        <RoleResponsibilitiesModal
          va={va}
          accessToken={accessToken}
          onClose={() => setShowRoleModal(false)}
          onSaved={(desc) => {
            setLocalJobDescription(desc);
            setShowRoleModal(false);
          }}
        />
      )}

      {/* ── Activity Log ─────────────────────────────────────────────── */}
      {role === "admin" && (
        <div className="px-6 pb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              Activity Log — {activityLogLabel}
            </h2>
            <button
              type="button"
              onClick={() => fetchDailySummary(false)}
              disabled={loadingSummary}
              className="text-xs text-blue-500 hover:text-blue-600 flex items-center gap-1 transition-colors"
            >
              <svg
                className={`w-3 h-3 ${loadingSummary ? "animate-spin" : ""}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M21 12a9 9 0 11-6.219-8.56" />
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

      {/* ── Work Category Analytics ──────────────────────────────────── */}
      <VAAnalyticsSection
        vaId={va.vaId}
        date={today}
        accessToken={accessToken}
      />
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

const ALLOWED_ROLES = new Set(["admin", "supervisor", "manager"]);

export default function VAMonitorView() {
  const { accessToken, user, assistantEmails, signOut, isLoading } = useAuthStore();
  const role = user?.role;
  const [data, setData] = useState<LiveResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedVaId, setSelectedVaId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedDate, setSelectedDate] = useState<string>(
    () => new Date().toISOString().split("T")[0],
  );
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"all" | "online" | "offline" | "at-risk">("all");

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

  const needsAttentionVAs = sortedVAs.filter((va) =>
    isNeedsAttention(getStatusBadge(va)),
  );
  const onTrackVAs = sortedVAs.filter(
    (va) => !isNeedsAttention(getStatusBadge(va)),
  );

  // Tab filtering
  const onlineVAs   = sortedVAs.filter((va) => va.status === "active");
  const offlineVAs  = sortedVAs.filter((va) => va.status === "idle" || va.status === "suspended");
  const atRiskVAs   = sortedVAs.filter((va) => isNeedsAttention(getStatusBadge(va)));

  const tabVAs =
    sidebarTab === "online"   ? onlineVAs  :
    sidebarTab === "offline"  ? offlineVAs :
    sidebarTab === "at-risk"  ? atRiskVAs  :
    sortedVAs;

  const tabNeedsAttention = tabVAs.filter((va) => isNeedsAttention(getStatusBadge(va)));
  const tabOnTrack        = tabVAs.filter((va) => !isNeedsAttention(getStatusBadge(va)));

  const selectedVa = sortedVAs.find((va) => va.vaId === selectedVaId) ?? null;
  const supervisorName =
    user?.user_metadata?.name ?? user?.name ?? user?.email ?? "Admin";
  const activeCount = data?.activeCount ?? 0;
  const offlineCount = data?.idleCount ?? 0;

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!role || !ALLOWED_ROLES.has(role)) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-gray-50 gap-3">
        <svg
          className="w-12 h-12 text-gray-300"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4M12 16h.01" />
        </svg>
        <p className="text-sm font-semibold text-gray-700">Access Denied</p>
        <p className="text-xs text-gray-400">
          This dashboard is only available to admins, supervisors, and managers.
        </p>
        <button
          type="button"
          onClick={signOut}
          className="mt-2 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">
      {/* ── Top Header ──────────────────────────────────────────────── */}
      <TopHeader
        supervisorName={supervisorName}
        role={role}
        activeCount={activeCount}
        flaggedCount={needsAttentionVAs.length}
        offlineCount={offlineCount}
        onSignOut={signOut}
        onSendInvitations={() => setShowInviteModal(true)}
      />

      {showInviteModal && (
        <InviteModal accessToken={accessToken} onClose={() => setShowInviteModal(false)} />
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left Sidebar ──────────────────────────────────────────── */}
        <div className="w-[400px] shrink-0 bg-white border-r border-gray-200 flex flex-col h-full overflow-hidden">
          {/* Search */}
          <div className="px-3 pt-3 pb-2 border-b border-gray-100">
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
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-gray-200 bg-white text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
              />
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-gray-100 shrink-0">
            {(
              [
                { key: "all",      label: "All",      count: sortedVAs.length },
                { key: "online",   label: "Online",   count: onlineVAs.length },
                { key: "offline",  label: "Offline",  count: offlineVAs.length },
                { key: "at-risk",  label: "At Risk",  count: atRiskVAs.length },
              ] as const
            ).map(({ key, label, count }) => (
              <button
                key={key}
                type="button"
                onClick={() => setSidebarTab(key)}
                className={`flex-1 flex items-center justify-center gap-1 py-2 text-[11px] font-medium border-b-2 transition-colors ${
                  sidebarTab === key
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-400 hover:text-gray-600"
                }`}
              >
                {label}
                <span
                  className={`inline-flex items-center justify-center rounded-full px-1.5 min-w-[18px] h-[18px] text-[10px] font-semibold ${
                    sidebarTab === key
                      ? key === "at-risk"
                        ? "bg-red-100 text-red-600"
                        : "bg-blue-100 text-blue-600"
                      : "bg-gray-100 text-gray-400"
                  }`}
                >
                  {count}
                </span>
              </button>
            ))}
          </div>

          {/* VA List */}
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
            ) : tabVAs.length === 0 ? (
              <div className="flex items-center justify-center py-16">
                <p className="text-sm text-gray-400">
                  {search ? "No matching VAs found" : `No ${sidebarTab === "all" ? "" : sidebarTab + " "}VAs`}
                </p>
              </div>
            ) : (
              <>
                {tabNeedsAttention.length > 0 && (
                  <div>
                    <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
                      <div className="flex items-center gap-1.5">
                        <svg
                          className="w-3.5 h-3.5 text-amber-500"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                          <line x1="12" y1="9" x2="12" y2="13" />
                          <line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>
                        <span className="text-[11px] font-semibold text-amber-600 uppercase tracking-wide">
                          Needs Attention ({tabNeedsAttention.length})
                        </span>
                      </div>
                    </div>
                    {tabNeedsAttention.map((va) => (
                      <VACard
                        key={va.vaId}
                        va={va}
                        isSelected={selectedVaId === va.vaId}
                        onClick={() => setSelectedVaId(va.vaId)}
                      />
                    ))}
                  </div>
                )}

                {tabOnTrack.length > 0 && (
                  <div>
                    <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                        <span className="text-[11px] font-semibold text-emerald-600 uppercase tracking-wide">
                          On Track ({tabOnTrack.length})
                        </span>
                      </div>
                    </div>
                    {tabOnTrack.map((va) => (
                      <VACard
                        key={va.vaId}
                        va={va}
                        isSelected={selectedVaId === va.vaId}
                        onClick={() => setSelectedVaId(va.vaId)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Invite Section */}
          <InviteSection accessToken={accessToken} />
        </div>

        {/* ── Right Panel ───────────────────────────────────────────── */}
        {selectedVa ? (
          <VADetailPanel
            va={selectedVa}
            accessToken={accessToken}
            date={selectedDate}
            role={role}
            onDateChange={setSelectedDate}
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
    </div>
  );
}
