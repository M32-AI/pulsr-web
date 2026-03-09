"use client";

import { useEffect, useState, useCallback } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

const CATEGORY_COLORS: Record<string, string> = {
  "Customer Support": "#3B82F6",
  "Data Entry": "#10B981",
  Research: "#8B5CF6",
  "Content & Writing": "#F59E0B",
  Communication: "#06B6D4",
  "Project Management": "#F97316",
  Design: "#EC4899",
  "Bookkeeping & Finance": "#84CC16",
  "E-commerce": "#14B8A6",
  Idle: "#9CA3AF",
  "Off-task": "#EF4444",
};

function categoryColor(cat: string): string {
  return CATEGORY_COLORS[cat] ?? "#6B7280";
}

interface CategoryEntry {
  category: string;
  count: number;
  avgProductivity: number;
  percentage: number;
}

interface HourlyEntry {
  hour: number;
  category: string;
  count: number;
}

interface AnalyticsData {
  totalAnalyzed: number;
  categories: CategoryEntry[];
  hourlyBreakdown: HourlyEntry[];
}

function formatHour(h: number): string {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

function buildHourlyChartData(
  hourlyBreakdown: HourlyEntry[],
  categories: string[],
): Array<Record<string, string | number>> {
  const byHour = new Map<number, Record<string, number>>();
  for (const row of hourlyBreakdown) {
    if (!byHour.has(row.hour)) byHour.set(row.hour, {});
    byHour.get(row.hour)![row.category] = row.count;
  }
  const hours = Array.from(byHour.keys()).sort((a, b) => a - b);
  return hours.map((h) => {
    const row: Record<string, string | number> = { hour: formatHour(h) };
    for (const cat of categories) {
      row[cat] = byHour.get(h)?.[cat] ?? 0;
    }
    return row;
  });
}

interface PieLabelProps {
  cx: number;
  cy: number;
  midAngle: number;
  innerRadius: number;
  outerRadius: number;
  percent: number;
}

function renderCustomPieLabel({
  cx,
  cy,
  midAngle,
  innerRadius,
  outerRadius,
  percent,
}: PieLabelProps) {
  if (percent < 0.05) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.55;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text
      x={x}
      y={y}
      fill="white"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={11}
      fontWeight={600}
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

interface VAAnalyticsSectionProps {
  vaId: string;
  date: string;
  accessToken: string | null;
}

export default function VAAnalyticsSection({
  vaId,
  date,
  accessToken,
}: VAAnalyticsSectionProps) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `${API_BASE_URL}/admin/analytics/categories?va_id=${encodeURIComponent(vaId)}&date=${encodeURIComponent(date)}`;
      const res = await fetch(url, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const json: AnalyticsData = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [vaId, date, accessToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const categoryNames = data?.categories.map((c) => c.category) ?? [];
  const hourlyChartData = data
    ? buildHourlyChartData(data.hourlyBreakdown, categoryNames)
    : [];

  return (
    <div className="border-t border-gray-100 px-6 py-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
          Work Category Analytics
        </h2>
        {data && (
          <span className="text-xs text-gray-400">
            {data.totalAnalyzed} analyzed screenshot
            {data.totalAnalyzed !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center justify-center py-8">
          <p className="text-sm text-red-400">Failed to load analytics</p>
        </div>
      )}

      {!loading && !error && data?.totalAnalyzed === 0 && (
        <div className="flex items-center justify-center py-8">
          <p className="text-sm text-gray-400">
            No analyzed screenshots for this day
          </p>
        </div>
      )}

      {!loading && !error && data && data.totalAnalyzed > 0 && (
        <div className="grid grid-cols-2 gap-6">
          <div>
            <p className="text-[10px] text-gray-400 uppercase font-medium mb-2 text-center">
              Category Distribution
            </p>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={data.categories}
                  dataKey="count"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  labelLine={false}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  label={renderCustomPieLabel as any}
                >
                  {data.categories.map((entry) => (
                    <Cell
                      key={entry.category}
                      fill={categoryColor(entry.category)}
                    />
                  ))}
                </Pie>
                <Tooltip
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(value: any, name: string) => [
                    `${value} screenshots`,
                    name,
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 justify-center">
              {data.categories.map((c) => (
                <div key={c.category} className="flex items-center gap-1">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: categoryColor(c.category) }}
                  />
                  <span className="text-[10px] text-gray-500">
                    {c.category}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    ({c.percentage}%)
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] text-gray-400 uppercase font-medium mb-2 text-center">
              Hourly Breakdown
            </p>
            {hourlyChartData.length === 0 ? (
              <div className="flex items-center justify-center h-[200px]">
                <p className="text-xs text-gray-400">No hourly data</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={hourlyChartData}
                  margin={{ top: 0, right: 0, left: -20, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="hour"
                    tick={{ fontSize: 9, fill: "#9CA3AF" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: "#9CA3AF" }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={(value: any, name: string) => [
                      `${value} screenshot${value !== 1 ? "s" : ""}`,
                      name,
                    ]}
                  />
                  {categoryNames.map((cat) => (
                    <Bar
                      key={cat}
                      dataKey={cat}
                      stackId="a"
                      fill={categoryColor(cat)}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
