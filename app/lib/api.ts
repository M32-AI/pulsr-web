import { useAuthStore } from "@/app/store/authStore";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

function getAccessToken() {
  return useAuthStore.getState().accessToken ?? "";
}

function buildHeaders(accessToken: string, overrides: RequestInit["headers"] = {}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...((overrides as Record<string, string>) ?? {}),
  };
}

async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  let accessToken = getAccessToken();
  let res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: buildHeaders(accessToken, options.headers),
  });

  if (res.status === 401) {
    try {
      await useAuthStore.getState().refreshSession();
      accessToken = getAccessToken();
      res = await fetch(`${API_URL}${path}`, {
        ...options,
        headers: buildHeaders(accessToken, options.headers),
      });
    } catch {
      // refreshSession already called signOut — return the 401 so callers handle it
    }
  }

  return res;
}

export async function getLive() {
  const res = await apiFetch("/live");
  if (!res.ok) throw new Error("Failed to fetch live data");
  return res.json();
}

export async function setMonitoring(vaId: string, enabled: boolean) {
  const res = await apiFetch(`/api/users/${vaId}/monitoring`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error("Failed to update monitoring setting");
  return res.json();
}

export type AttendanceFlag = "absent" | "late_start" | "early_end" | "overtime";

/**
 * How the VA's day measured up against their shift. Absent when the VA has no
 * shift on record — the tracker cannot judge a day it has no schedule for.
 */
export interface ShiftCompliance {
  /** ISO instants of the scheduled shift boundaries for this date. */
  shiftStart: string;
  shiftEnd: string;
  /** First tracked start / last tracked end, or null while it hasn't happened. */
  actualStart: string | null;
  actualEnd: string | null;
  lateStartSeconds: number;
  earlyEndSeconds: number;
  overtimeSeconds: number;
  flags: AttendanceFlag[];
}

export interface DailyAttendanceRow {
  vaId: string;
  email: string;
  name: string | null;
  hasShift: boolean;
  timezone: string;
  workSeconds: number;
  breakSeconds: number;
  firstSessionStart: string | null;
  lastSessionEnd: string | null;
  flags: AttendanceFlag[];
  compliance: ShiftCompliance | null;
}

export interface DailyAttendanceResponse {
  date: string;
  summary: {
    totalVAs: number;
    withShiftOnRecord: number;
    tracked: number;
    absent: number;
    lateStart: number;
  };
  vas: DailyAttendanceRow[];
}

export async function getDailyAttendance(date?: string): Promise<DailyAttendanceResponse> {
  const res = await apiFetch(`/admin/reports/daily-attendance${date ? `?date=${date}` : ""}`);
  if (!res.ok) throw new Error("Failed to fetch daily attendance report");
  return res.json();
}

// Break analytics (PRODUCT-25702)

export type BreakFlag = "over_daily_limit" | "over_weekly_limit" | "no_breaks_recorded";

export interface BreakDay {
  /** The VA's own local date, "YYYY-MM-DD". */
  date: string;
  breakSeconds: number;
  breakCount: number;
  workSeconds: number;
  overLimit: boolean;
}

export interface BreakWeek {
  weekStart: string;
  breakSeconds: number;
  trackedDays: number;
  complete: boolean;
  overLimit: boolean;
}

export interface VaBreakAnalytics {
  vaId: string;
  email: string;
  name: string | null;
  timezone: string;
  trackedDays: number;
  daysWithBreak: number;
  breakSessions: number;
  totalBreakSeconds: number;
  avgBreakSecondsPerDay: number;
  /** Null when the window holds no whole Mon–Sun week to average. */
  avgBreakSecondsPerWeek: number | null;
  daysOverLimit: number;
  weeksOverLimit: number;
  longestBreakDay: BreakDay | null;
  flags: BreakFlag[];
  days: BreakDay[];
  weeks: BreakWeek[];
}

export interface BreakAnalyticsResponse {
  window: { days: number; startDate: string; endDate: string };
  limits: { dailySeconds: number; weeklySeconds: number };
  summary: {
    totalVAs: number;
    vasWithTrackedDays: number;
    vasWithBreaks: number;
    vasWithNoBreaksRecorded: number;
    vasOverDailyLimit: number;
    vasOverWeeklyLimit: number;
    totalBreakSessions: number;
    avgBreakSecondsPerDay: number;
  };
  vas: VaBreakAnalytics[];
}

/** Omit `vaId` for the whole fleet the caller is allowed to see. */
export async function getBreakAnalytics(
  days = 30,
  vaId?: string,
): Promise<BreakAnalyticsResponse> {
  const params = new URLSearchParams({ days: String(days) });
  if (vaId) params.set("va_id", vaId);
  const res = await apiFetch(`/admin/analytics/breaks?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `Server returned ${res.status}`);
  }
  return res.json();
}

export async function getQueueStats() {
  const res = await apiFetch("/admin/queue-stats");
  if (!res.ok) throw new Error("Failed to fetch queue stats");
  return res.json();
}

export async function getActivity(vaId: string, startDate: string, endDate: string) {
  const res = await apiFetch(`/activity/${vaId}?startDate=${startDate}&endDate=${endDate}`);
  if (!res.ok) throw new Error("Failed to fetch activity");
  return res.json();
}

export async function getScreenshots(
  vaId: string,
  start: string,
  end: string,
  timezone: string,
  offset = 0
) {
  const params = new URLSearchParams({ va_id: vaId, start, end, timezone, offset: String(offset) });
  const res = await apiFetch(`/admin/screenshots?${params}`);
  if (!res.ok) throw new Error("Failed to fetch screenshots");
  return res.json();
}

export async function getCategoryAnalytics(vaId: string, date: string, timezone: string) {
  const params = new URLSearchParams({ va_id: vaId, date, timezone });
  const res = await apiFetch(`/admin/analytics/categories?${params}`);
  if (!res.ok) throw new Error("Failed to fetch analytics");
  return res.json();
}

// Session API

export type SessionStatus = "active" | "suspended" | "idle" | "expired";

export interface SessionResult {
  sessionId: string;
  status: SessionStatus;
  startTime: string | null;
}

export async function sessionStart(): Promise<SessionResult> {
  const res = await apiFetch("/sessions/start", { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? "Failed to start session");
  return { sessionId: data.sessionId ?? data.session_id, status: data.status, startTime: data.startTime ?? data.start_time ?? null };
}

export async function sessionStop(): Promise<void> {
  const res = await apiFetch("/sessions/stop", { method: "POST" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error ?? "Failed to stop session");
  }
}

// Alerts API

export interface Alert {
  id: string;
  vaId: string;
  sessionId: string | null;
  screenshotId: string | null;
  alertType:
    | "long_break"
    | "high_non_work_activity"
    | "policy_violation"
    | "session_idle"
    | "inactivity"
    | "non_work_activity"
    | "break_overtime"
    | "late_clock_in"
    // Written before PRODUCT-24383; new detections use "poaching".
    | "off_platform"
    | "inappropriate_behavior"
    | "poaching";
  severity: "alert" | "warning" | "quality" | "severe";
  message: string;
  metadata: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: string;
  vaEmail?: string | null;
  screenshotCapturedAt?: string | null;
}

/** Both the current and the legacy type for the same risk (PRODUCT-24383). */
export function isPoachingAlert(alert: Pick<Alert, "alertType">): boolean {
  return alert.alertType === "poaching" || alert.alertType === "off_platform";
}

/**
 * The verbatim lines that triggered a poaching alert, when the caller is allowed
 * to see them. `/api/alerts` strips these for supervisors, who must never be
 * shown screenshot-derived content (PRODUCT-25750), so an empty list here just
 * means "not available to you" — never "no evidence".
 */
export function poachingQuotes(alert: Alert): string[] {
  const quotes = alert.metadata?.quotes;
  return Array.isArray(quotes) ? quotes.filter((q): q is string => typeof q === "string") : [];
}

export type PoachingDirection = "client_to_va" | "va_to_client" | "mutual" | "unclear";

export function poachingDirection(alert: Alert): PoachingDirection | null {
  const d = alert.metadata?.direction;
  return d === "client_to_va" || d === "va_to_client" || d === "mutual" || d === "unclear"
    ? d
    : null;
}

export const POACHING_DIRECTION_LABELS: Record<PoachingDirection, string> = {
  client_to_va: "Client → VA",
  va_to_client: "VA → client",
  mutual: "Both sides",
  unclear: "Direction unclear",
};

/**
 * Dashboard deep-link to the evidence behind an alert: the VA, the moment it
 * happened, and (when the alert came from a specific screenshot) the image.
 * Window-based alerts anchor on the window midpoint so the expanded hour
 * block is the one that actually contains the evidence.
 */
export function alertEvidenceUrl(alert: Alert): string {
  const windowMinutes = Number(alert.metadata?.windowMinutes ?? 0);
  const ts =
    alert.screenshotCapturedAt ??
    (windowMinutes > 0
      ? new Date(new Date(alert.createdAt).getTime() - windowMinutes * 30_000).toISOString()
      : alert.createdAt);
  const params = new URLSearchParams({ va: alert.vaId, ts });
  if (alert.screenshotId) params.set("screenshot", alert.screenshotId);
  return `/admin/dashboard?${params.toString()}`;
}

export async function getAlerts(
  unreadOnly = false,
  limit = 50,
  offset = 0,
  /**
   * Restrict to specific alert types. Needed to find a rare type reliably:
   * prod writes thousands of productivity alerts, so the newest N alerts can
   * span only a few hours and an older poaching alert would never appear
   * (PRODUCT-24383).
   */
  alertTypes?: Alert["alertType"][]
): Promise<{ alerts: Alert[]; total: number; unreadCount: number }> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (unreadOnly) params.set("unread_only", "true");
  if (alertTypes?.length) params.set("alert_type", alertTypes.join(","));
  const res = await apiFetch(`/api/alerts?${params}`);
  if (!res.ok) throw new Error("Failed to fetch alerts");
  return res.json();
}

/** Both alert types that represent poaching risk (PRODUCT-24383). */
export const POACHING_ALERT_TYPES: Alert["alertType"][] = ["poaching", "off_platform"];

export async function markAlertsRead(ids: string[]): Promise<void> {
  const res = await apiFetch("/api/alerts/mark-read", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error("Failed to mark alerts read");
}

// Push notifications API

export async function getVapidPublicKey(): Promise<{ publicKey: string }> {
  const res = await apiFetch("/api/push/vapid-public-key");
  if (!res.ok) throw new Error("Push notifications not available");
  return res.json();
}

export async function subscribePush(subscription: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}): Promise<void> {
  const res = await apiFetch("/api/push/subscribe", {
    method: "POST",
    body: JSON.stringify(subscription),
  });
  if (!res.ok) throw new Error("Failed to save push subscription");
}

export interface PushTestResult {
  /** Subscriptions the server tried. 0 = desktop alerts are not enabled anywhere. */
  total: number;
  sent: number;
  failed: number;
  /** Subscriptions the push service rejected as gone; the server deleted them. */
  expired: number;
  error?: string;
}

/**
 * Ask the server to push a test notification to this user's own devices
 * (PRODUCT-24383) — proves VAPID config, the stored subscription, the push
 * service, the service worker, and the click-through all work.
 */
export async function sendTestPush(): Promise<PushTestResult> {
  const res = await apiFetch("/api/push/test", { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? "Failed to send test notification");
  return data;
}

export async function unsubscribePush(endpoint: string): Promise<void> {
  const res = await apiFetch("/api/push/unsubscribe", {
    method: "POST",
    body: JSON.stringify({ endpoint }),
  });
  if (!res.ok) throw new Error("Failed to remove push subscription");
}

export interface LowProductivityScreenshot {
  id: string;
  sessionId: string;
  vaId: string;
  vaEmail: string;
  capturedAt: string;
  category: string | null;
  subcategory: string | null;
  activeApplication: string | null;
  windowTitle: string | null;
  productivityScore: number | null;
  confidence: number | null;
  summary: string | null;
  visibleTools: string[] | null;
  flags: string[] | null;
  containsSensitiveData: boolean | null;
  isIdle: boolean | null;
  s3Key: string;
  s3Bucket: string;
  modelUsed: string | null;
  promptVersion: string | null;
  presignedUrl: string | null;
  logModel: string | null;
  systemPrompt: string | null;
  rawResponse: string | null;
  logTokensUsed: number | null;
  durationMs: number | null;
}

export interface LowProductivityResponse {
  maxScore: number;
  limit: number;
  offset: number;
  total: number;
  hasNext: boolean;
  screenshots: LowProductivityScreenshot[];
}

export async function getLowProductivityScreenshots(
  maxScore = 40,
  offset = 0
): Promise<LowProductivityResponse> {
  const params = new URLSearchParams({ max_score: String(maxScore), offset: String(offset) });
  const res = await apiFetch(`/admin/low-productivity?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `Server returned ${res.status}`);
  }
  return res.json();
}

export async function sessionRestore(): Promise<SessionResult | null> {
  const res = await apiFetch("/sessions?status=active&limit=1");
  if (!res.ok) return null;
  const data = await res.json();
  const session = Array.isArray(data) ? data[0] : data?.sessions?.[0];
  if (!session) return null;
  return {
    sessionId: session.id ?? session.sessionId ?? session.session_id,
    status: session.status,
    startTime: session.startTime ?? session.start_time ?? null,
  };
}
