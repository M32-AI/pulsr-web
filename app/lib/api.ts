import { useAuthStore } from "@/app/store/authStore";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

function getAccessToken() {
  return useAuthStore.getState().accessToken ?? "";
}

async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const accessToken = getAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...((options.headers as Record<string, string>) ?? {}),
  };
  return fetch(`${API_URL}${path}`, { ...options, headers });
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
