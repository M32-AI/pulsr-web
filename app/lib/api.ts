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
  alertType: "long_break" | "high_non_work_activity" | "policy_violation" | "session_idle";
  severity: "alert" | "warning" | "quality";
  message: string;
  metadata: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: string;
}

export async function getAlerts(
  unreadOnly = false,
  limit = 50
): Promise<{ alerts: Alert[]; total: number; unreadCount: number }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (unreadOnly) params.set("unread_only", "true");
  const res = await apiFetch(`/api/alerts?${params}`);
  if (!res.ok) throw new Error("Failed to fetch alerts");
  return res.json();
}

export async function markAlertsRead(ids: string[]): Promise<void> {
  const res = await apiFetch("/api/alerts/mark-read", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error("Failed to mark alerts read");
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
