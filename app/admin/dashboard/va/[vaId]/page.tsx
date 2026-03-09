"use client";

import { useEffect, useState, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getActivity, getScreenshots, getCategoryAnalytics } from "../../../../lib/api";

type Tab = "activity" | "screenshots" | "analytics";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatSecs(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function nDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function browserTz(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface DayCompliance {
  shiftStart: string;
  shiftEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
  lateStartFormatted: string;
  earlyEndFormatted: string;
  overtimeFormatted: string;
  flags: string[];
}

interface DaySummary {
  sessionCount: number;
  totalActiveSeconds: number;
  totalActiveFormatted: string;
  totalIdleSeconds: number;
  totalIdleFormatted: string;
}

interface DayEntry {
  date: string;
  summary: DaySummary;
  compliance: DayCompliance | null;
  activePeriods: Array<{
    sessionId: string;
    status: string;
    start: string;
    end: string;
    activeSeconds: number;
    idleSeconds: number;
  }>;
  gaps: Array<{
    type: string;
    start: string;
    end: string;
    durationFormatted: string;
  }>;
}

interface ActivityData {
  vaId: string;
  email: string;
  shift: { startTime: string; endTime: string; timezone: string } | null;
  summary: {
    totalDays: number;
    activeDays: number;
    totalActiveFormatted: string;
    totalIdleFormatted: string;
  };
  days: Record<string, DayEntry>;
}

interface Screenshot {
  id: string;
  capturedAt: string;
  status: string;
  presignedUrl: string;
  aiAnalysis?: {
    category?: string;
    productivityScore?: number;
    appName?: string;
    activityDescription?: string;
  } | null;
}

interface ScreenshotData {
  screenshots: Screenshot[];
  hasNext: boolean;
  offset: number;
  limit: number;
}

interface CategoryData {
  totalAnalyzed: number;
  categories: Array<{ category: string; count: number; avgProductivity: number; percentage: number }>;
  hourlyBreakdown: Array<{ hour: number; category: string; count: number }>;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FlagBadge({ flag }: { flag: string }) {
  const colors: Record<string, string> = {
    late_start: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
    early_end: "text-orange-400 bg-orange-400/10 border-orange-400/20",
    overtime: "text-blue-400 bg-blue-400/10 border-blue-400/20",
    absent: "text-red-400 bg-red-400/10 border-red-400/20",
  };
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs border ${colors[flag] ?? "text-zinc-400 bg-zinc-800 border-zinc-700"}`}
    >
      {flag.replace("_", " ")}
    </span>
  );
}

function categoryColor(cat: string): string {
  const c = cat.toLowerCase();
  if (c.includes("product") || c.includes("work")) return "bg-green-500";
  if (c.includes("unproduct") || c.includes("distract") || c.includes("social")) return "bg-red-500";
  if (c.includes("break") || c.includes("idle")) return "bg-yellow-500";
  return "bg-blue-500";
}

function productivityColor(score: number): string {
  if (score >= 0.7) return "text-green-400";
  if (score >= 0.4) return "text-yellow-400";
  return "text-red-400";
}

// ── Activity Tab ──────────────────────────────────────────────────────────────

function ActivityTab({ vaId }: { vaId: string }) {
  const [startDate, setStartDate] = useState(nDaysAgo(6));
  const [endDate, setEndDate] = useState(todayStr());
  const [data, setData] = useState<ActivityData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await getActivity(vaId, startDate, endDate);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load activity");
    } finally {
      setLoading(false);
    }
  }, [vaId, startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const days = data ? Object.values(data.days) : [];
  const activeDays = days.filter((d) => d.summary.sessionCount > 0);

  return (
    <div>
      {/* Date range */}
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div>
          <label className="block text-xs text-zinc-500 mb-1">From</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-500 mb-1">To</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
          />
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="bg-white text-black rounded-lg px-4 py-2 text-sm font-medium hover:bg-zinc-100 transition-colors disabled:opacity-50"
        >
          {loading ? "Loading…" : "Load"}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-400 mb-4">{error}</p>
      )}

      {data && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {[
              { label: "Active days", value: `${data.summary.activeDays} / ${data.summary.totalDays}` },
              { label: "Total active", value: data.summary.totalActiveFormatted },
              { label: "Total idle", value: data.summary.totalIdleFormatted },
              { label: "Shift", value: data.shift ? `${data.shift.startTime?.slice(0, 5)} – ${data.shift.endTime?.slice(0, 5)}` : "No shift" },
            ].map((c) => (
              <div key={c.label} className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-4">
                <p className="text-xs text-zinc-500 mb-1">{c.label}</p>
                <p className="text-lg font-semibold text-white">{c.value}</p>
              </div>
            ))}
          </div>

          {/* Days table */}
          <div className="space-y-2">
            {days.map((day) => {
              const isExpanded = expandedDay === day.date;
              const hasActivity = day.summary.sessionCount > 0;
              return (
                <div
                  key={day.date}
                  className="bg-zinc-800/30 border border-zinc-800 rounded-xl overflow-hidden"
                >
                  <button
                    className="w-full px-5 py-3.5 flex items-center gap-4 text-left hover:bg-zinc-800/50 transition-colors"
                    onClick={() => setExpandedDay(isExpanded ? null : day.date)}
                  >
                    <span className="text-sm font-medium text-zinc-300 w-28 shrink-0">
                      {new Date(day.date + "T12:00:00Z").toLocaleDateString([], {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    {hasActivity ? (
                      <>
                        <span className="text-xs font-mono text-zinc-300">
                          {day.summary.totalActiveFormatted} active
                        </span>
                        <span className="text-xs text-zinc-600">
                          {day.summary.sessionCount} session{day.summary.sessionCount !== 1 ? "s" : ""}
                        </span>
                        {day.compliance?.flags.map((f) => (
                          <FlagBadge key={f} flag={f} />
                        ))}
                      </>
                    ) : (
                      <span className="text-xs text-zinc-600">No activity</span>
                    )}
                    <span className="ml-auto text-zinc-600 text-xs">{isExpanded ? "▲" : "▼"}</span>
                  </button>

                  {isExpanded && hasActivity && (
                    <div className="px-5 pb-4 border-t border-zinc-800 pt-4 space-y-4">
                      {/* Compliance */}
                      {day.compliance && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                          <div>
                            <p className="text-zinc-500">Shift start</p>
                            <p className="text-zinc-300 mt-0.5">{fmtTime(day.compliance.shiftStart)}</p>
                          </div>
                          <div>
                            <p className="text-zinc-500">Actual start</p>
                            <p className="text-zinc-300 mt-0.5">{fmtTime(day.compliance.actualStart)}</p>
                          </div>
                          <div>
                            <p className="text-zinc-500">Late start</p>
                            <p className={`mt-0.5 ${day.compliance.lateStartFormatted !== "0s" ? "text-yellow-400" : "text-zinc-500"}`}>
                              {day.compliance.lateStartFormatted}
                            </p>
                          </div>
                          <div>
                            <p className="text-zinc-500">Early end</p>
                            <p className={`mt-0.5 ${day.compliance.earlyEndFormatted !== "0s" ? "text-orange-400" : "text-zinc-500"}`}>
                              {day.compliance.earlyEndFormatted}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Sessions */}
                      <div>
                        <p className="text-xs text-zinc-500 mb-2">Sessions</p>
                        <div className="space-y-1.5">
                          {day.activePeriods.map((p) => (
                            <div
                              key={p.sessionId}
                              className="flex items-center gap-4 text-xs text-zinc-400 bg-zinc-900 rounded-lg px-3 py-2"
                            >
                              <span className="font-mono">
                                {fmtTime(p.start)} → {fmtTime(p.end)}
                              </span>
                              <span>{formatSecs(p.activeSeconds)} active</span>
                              {p.idleSeconds > 0 && (
                                <span className="text-zinc-600">{formatSecs(p.idleSeconds)} idle</span>
                              )}
                              <span
                                className={`ml-auto px-1.5 py-0.5 rounded text-xs ${
                                  p.status === "active"
                                    ? "text-green-400 bg-green-400/10"
                                    : "text-zinc-500 bg-zinc-800"
                                }`}
                              >
                                {p.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Gaps */}
                      {day.gaps.length > 0 && (
                        <div>
                          <p className="text-xs text-zinc-500 mb-2">Gaps</p>
                          <div className="space-y-1">
                            {day.gaps.map((g, i) => (
                              <div key={i} className="flex items-center gap-3 text-xs text-zinc-500">
                                <span className="font-mono">
                                  {fmtTime(g.start)} → {fmtTime(g.end)}
                                </span>
                                <span className="text-zinc-600">{g.durationFormatted}</span>
                                <span className="text-zinc-700">{g.type.replace("_", " ")}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {days.length === 0 && !loading && (
              <p className="text-center text-zinc-600 text-sm py-12">No data for this range</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Screenshots Tab ───────────────────────────────────────────────────────────

function ScreenshotsTab({ vaId }: { vaId: string }) {
  const [date, setDate] = useState(todayStr());
  const [data, setData] = useState<ScreenshotData | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async (off = 0) => {
    setLoading(true);
    setError("");
    try {
      const tz = browserTz();
      const res = await getScreenshots(
        vaId,
        `${date}T00:00:00`,
        `${date}T23:59:59`,
        tz,
        off
      );
      setData(res);
      setOffset(off);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load screenshots");
    } finally {
      setLoading(false);
    }
  }, [vaId, date]);

  useEffect(() => { load(0); }, [load]);

  const shots: Screenshot[] = data?.screenshots ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
          />
        </div>
        <button
          onClick={() => load(0)}
          disabled={loading}
          className="bg-white text-black rounded-lg px-4 py-2 text-sm font-medium hover:bg-zinc-100 transition-colors disabled:opacity-50"
        >
          {loading ? "Loading…" : "Load"}
        </button>
      </div>

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      {data && (
        <p className="text-xs text-zinc-500 mb-4">
          {shots.length} screenshot{shots.length !== 1 ? "s" : ""}
          {data.hasNext ? " (more available)" : ""}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {shots.map((s) => (
          <div
            key={s.id}
            className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={s.presignedUrl}
              alt={`Screenshot at ${s.capturedAt}`}
              className="w-full aspect-video object-cover bg-zinc-800 cursor-pointer"
              onClick={() => setExpanded(expanded === s.id ? null : s.id)}
              loading="lazy"
            />
            <div className="px-3 py-2.5">
              <p className="text-xs text-zinc-400 font-mono">{fmtDateTime(s.capturedAt)}</p>
              {s.aiAnalysis && (
                <div className="mt-1.5 space-y-0.5">
                  {s.aiAnalysis.appName && (
                    <p className="text-xs text-zinc-300">{s.aiAnalysis.appName}</p>
                  )}
                  <div className="flex items-center gap-2">
                    {s.aiAnalysis.category && (
                      <span className="text-xs text-zinc-500 capitalize">{s.aiAnalysis.category}</span>
                    )}
                    {s.aiAnalysis.productivityScore != null && (
                      <span
                        className={`text-xs font-medium ${productivityColor(s.aiAnalysis.productivityScore)}`}
                      >
                        {Math.round(s.aiAnalysis.productivityScore * 100)}%
                      </span>
                    )}
                  </div>
                  {expanded === s.id && s.aiAnalysis.activityDescription && (
                    <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                      {s.aiAnalysis.activityDescription}
                    </p>
                  )}
                </div>
              )}
              {s.status !== "analyzed" && (
                <p className="text-xs text-zinc-600 mt-1 capitalize">{s.status}</p>
              )}
            </div>
          </div>
        ))}
        {shots.length === 0 && !loading && (
          <p className="col-span-full text-center text-zinc-600 text-sm py-12">
            No screenshots for this date
          </p>
        )}
      </div>

      {/* Pagination */}
      {data && (data.hasNext || offset > 0) && (
        <div className="flex items-center justify-between mt-6">
          <button
            onClick={() => load(Math.max(0, offset - data.limit))}
            disabled={offset === 0 || loading}
            className="text-sm text-zinc-400 hover:text-white disabled:opacity-30 transition-colors"
          >
            ← Previous
          </button>
          <button
            onClick={() => load(offset + data.limit)}
            disabled={!data.hasNext || loading}
            className="text-sm text-zinc-400 hover:text-white disabled:opacity-30 transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

// ── Analytics Tab ─────────────────────────────────────────────────────────────

function AnalyticsTab({ vaId }: { vaId: string }) {
  const [date, setDate] = useState(todayStr());
  const [data, setData] = useState<CategoryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await getCategoryAnalytics(vaId, date, browserTz());
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, [vaId, date]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
          />
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="bg-white text-black rounded-lg px-4 py-2 text-sm font-medium hover:bg-zinc-100 transition-colors disabled:opacity-50"
        >
          {loading ? "Loading…" : "Load"}
        </button>
      </div>

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      {data && (
        <div className="space-y-6">
          <p className="text-xs text-zinc-500">
            {data.totalAnalyzed} analyzed screenshot{data.totalAnalyzed !== 1 ? "s" : ""}
          </p>

          {/* Category breakdown */}
          {data.categories.length > 0 ? (
            <div className="space-y-3">
              {data.categories.map((cat) => (
                <div key={cat.category}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-zinc-300 capitalize">{cat.category}</span>
                    <div className="flex items-center gap-3">
                      {/* <span
                        className={`text-xs font-medium ${productivityColor(cat.avgProductivity)}`}
                      >
                        avg {Math.round(cat.avgProductivity * 100)}%
                      </span> */}
                      <span className="text-xs text-zinc-400 w-12 text-right">
                        {cat.percentage}%
                      </span>
                      <span className="text-xs text-zinc-600 w-16 text-right">
                        {cat.count} shots
                      </span>
                    </div>
                  </div>
                  <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${categoryColor(cat.category)}`}
                      style={{ width: `${cat.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-zinc-600 text-sm">No analyzed screenshots for this date</p>
          )}

          {/* Hourly breakdown */}
          {data.hourlyBreakdown.length > 0 && (
            <div>
              <p className="text-xs text-zinc-500 mb-3">Hourly breakdown</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-800 text-left">
                      <th className="pb-2 text-zinc-500 font-medium">Hour</th>
                      <th className="pb-2 text-zinc-500 font-medium">Category</th>
                      <th className="pb-2 text-zinc-500 font-medium text-right">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.hourlyBreakdown.map((row, i) => (
                      <tr key={i} className="border-b border-zinc-800/40">
                        <td className="py-1.5 text-zinc-400 font-mono">
                          {String(row.hour).padStart(2, "0")}:00
                        </td>
                        <td className="py-1.5 text-zinc-300 capitalize">{row.category}</td>
                        <td className="py-1.5 text-zinc-400 text-right">{row.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function VADetailPage({ params }: { params: Promise<{ vaId: string }> }) {
  const { vaId } = use(params);
  const [tab, setTab] = useState<Tab>("activity");

  const tabs: { id: Tab; label: string }[] = [
    { id: "activity", label: "Activity" },
    { id: "screenshots", label: "Screenshots" },
    { id: "analytics", label: "Analytics" },
  ];

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center gap-4">
        <Link
          href="/admin/dashboard"
          className="text-xs text-zinc-500 hover:text-white transition-colors"
        >
          ← Dashboard
        </Link>
        <span className="text-zinc-800">|</span>
        <p className="text-xs font-mono text-zinc-400 truncate">{vaId}</p>
      </header>

      <main className="px-6 py-8 max-w-6xl mx-auto">
        {/* Tabs */}
        <div className="flex gap-1 mb-8 border-b border-zinc-800">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                tab === t.id
                  ? "border-white text-white"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "activity" && <ActivityTab vaId={vaId} />}
        {tab === "screenshots" && <ScreenshotsTab vaId={vaId} />}
        {tab === "analytics" && <AnalyticsTab vaId={vaId} />}
      </main>
    </div>
  );
}
