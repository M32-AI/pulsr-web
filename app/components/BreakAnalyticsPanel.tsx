"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  getBreakAnalytics,
  type BreakAnalyticsResponse,
  type VaBreakAnalytics,
} from "../lib/api";

/**
 * Break-time analytics for one VA (PRODUCT-25702): average break per tracked
 * day, per whole week, and whether they crossed the >2h/day or >10h/week
 * limits. Every number and threshold comes from the API — the limits are policy
 * and must not be duplicated as magic numbers in the UI.
 */

const WINDOW_DAYS = 30;
/** Days of history in the bar chart; the stats above it cover the full window. */
const CHART_DAYS = 21;

function secondsToHM(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** "Jul 14" from a "YYYY-MM-DD" local date, without re-interpreting the zone. */
function shortDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function Stat({
  label,
  value,
  alert = false,
  hint,
}: {
  label: string;
  value: string;
  alert?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <p className="text-[10px] text-gray-400 uppercase font-medium mb-0.5">{label}</p>
      <p className={`text-sm font-semibold ${alert ? "text-red-500" : "text-gray-800"}`}>
        {value}
      </p>
      {hint && <p className="text-[10px] text-gray-400 mt-0.5">{hint}</p>}
    </div>
  );
}

function Chip({ tone, children }: { tone: "danger" | "warn" | "muted"; children: string }) {
  const className =
    tone === "danger"
      ? "bg-red-50 text-red-600 border-red-100"
      : tone === "warn"
        ? "bg-amber-50 text-amber-600 border-amber-100"
        : "bg-gray-50 text-gray-500 border-gray-200";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${className}`}
    >
      {children}
    </span>
  );
}

export default function BreakAnalyticsPanel({ vaId }: { vaId: string }) {
  const [data, setData] = useState<BreakAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setData(await getBreakAnalytics(WINDOW_DAYS, vaId));
    } catch {
      setError(true);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [vaId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const va: VaBreakAnalytics | null = data?.vas[0] ?? null;
  const dailyLimit = data?.limits.dailySeconds ?? 0;
  const weeklyLimit = data?.limits.weeklySeconds ?? 0;

  const chartData = (va?.days ?? []).slice(-CHART_DAYS).map((d) => ({
    date: shortDate(d.date),
    minutes: Math.round(d.breakSeconds / 60),
    overLimit: d.overLimit,
  }));

  return (
    <div className="mx-6 mb-4 border border-gray-200 rounded-xl bg-white px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
          Break Analytics
        </h2>
        {data && (
          <span className="text-[10px] text-gray-400">
            last {data.window.days} days · limits {secondsToHM(dailyLimit)}/day ·{" "}
            {secondsToHM(weeklyLimit)}/week
          </span>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-8">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && error && (
        <p className="py-6 text-center text-sm text-red-400">Failed to load break analytics</p>
      )}

      {!loading && !error && va && va.trackedDays === 0 && (
        <p className="py-6 text-center text-sm text-gray-400">
          No tracked sessions in the last {data?.window.days} days
        </p>
      )}

      {!loading && !error && va && va.trackedDays > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-3">
            <Stat
              label="Avg / day"
              value={secondsToHM(va.avgBreakSecondsPerDay)}
              alert={va.avgBreakSecondsPerDay > dailyLimit}
              hint={`over ${va.trackedDays} tracked day${va.trackedDays === 1 ? "" : "s"}`}
            />
            <Stat
              label="Avg / week"
              value={
                va.avgBreakSecondsPerWeek === null
                  ? "--"
                  : secondsToHM(va.avgBreakSecondsPerWeek)
              }
              alert={
                va.avgBreakSecondsPerWeek !== null && va.avgBreakSecondsPerWeek > weeklyLimit
              }
              hint={
                va.avgBreakSecondsPerWeek === null
                  ? "no whole week yet"
                  : `over ${va.weeks.filter((w) => w.complete).length} whole week${
                      va.weeks.filter((w) => w.complete).length === 1 ? "" : "s"
                    }`
              }
            />
            <Stat
              label="Longest day"
              value={
                va.longestBreakDay && va.longestBreakDay.breakSeconds > 0
                  ? secondsToHM(va.longestBreakDay.breakSeconds)
                  : "--"
              }
              alert={va.longestBreakDay?.overLimit ?? false}
              hint={
                va.longestBreakDay && va.longestBreakDay.breakSeconds > 0
                  ? shortDate(va.longestBreakDay.date)
                  : undefined
              }
            />
            <Stat
              label="Breaks taken"
              value={String(va.breakSessions)}
              hint={`on ${va.daysWithBreak} of ${va.trackedDays} day${
                va.trackedDays === 1 ? "" : "s"
              }`}
            />
          </div>

          <div className="flex flex-wrap gap-1.5 mb-3">
            {va.flags.includes("over_daily_limit") && (
              <Chip tone="danger">
                {`Over ${secondsToHM(dailyLimit)} on ${va.daysOverLimit} day${
                  va.daysOverLimit === 1 ? "" : "s"
                }`}
              </Chip>
            )}
            {va.flags.includes("over_weekly_limit") && (
              <Chip tone="danger">
                {`Over ${secondsToHM(weeklyLimit)} in ${va.weeksOverLimit} week${
                  va.weeksOverLimit === 1 ? "" : "s"
                }`}
              </Chip>
            )}
            {va.flags.includes("no_breaks_recorded") && (
              <Chip tone="warn">
                {`No break recorded in ${va.trackedDays} tracked day${
                  va.trackedDays === 1 ? "" : "s"
                }`}
              </Chip>
            )}
            {va.flags.length === 0 && <Chip tone="muted">Within break policy</Chip>}
          </div>

          {chartData.length > 0 && (
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "#9CA3AF" }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#9CA3AF" }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                  unit="m"
                />
                <ReferenceLine
                  y={Math.round(dailyLimit / 60)}
                  stroke="#EF4444"
                  strokeDasharray="4 4"
                />
                <Tooltip
                  cursor={{ fill: "rgba(0,0,0,0.04)" }}
                  formatter={(value) => [secondsToHM(Number(value ?? 0) * 60), "Break"]}
                />
                <Bar dataKey="minutes" radius={[2, 2, 0, 0]}>
                  {chartData.map((d) => (
                    <Cell key={d.date} fill={d.overLimit ? "#EF4444" : "#3B82F6"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}

          <p className="text-[10px] text-gray-400 mt-2">
            Break length is wall time — time away from the keyboard counts as break, not as a
            deduction from it. Days are the VA&apos;s own local days ({va.timezone}).
          </p>
        </>
      )}
    </div>
  );
}
