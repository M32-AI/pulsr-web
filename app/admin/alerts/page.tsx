"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getAlerts, markAlertsRead, alertEvidenceUrl, type Alert } from "../../lib/api";

const PAGE_SIZE = 50;

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function absoluteTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

const SEVERITY_STYLES: Record<string, string> = {
  alert: "text-red-600 bg-red-50 border-red-200",
  warning: "text-orange-600 bg-orange-50 border-orange-200",
  quality: "text-blue-600 bg-blue-50 border-blue-200",
  severe: "text-red-900 bg-red-100 border-red-500 font-bold",
};

const SEVERITY_LABELS: Record<string, string> = {
  alert: "ALERT",
  warning: "WARNING",
  quality: "QUALITY",
  severe: "SEVERE",
};

const ALERT_TYPE_LABELS: Record<string, string> = {
  long_break: "Long Break",
  high_non_work_activity: "High Non-Work Activity",
  policy_violation: "Policy Violation",
  session_idle: "Session Idle",
  inactivity: "Inactivity",
  non_work_activity: "Non-Work Activity",
  break_overtime: "Break Overtime",
  late_clock_in: "Late Clock-In",
  off_platform: "Off Platform",
  inappropriate_behavior: "Inappropriate Behavior",
};

function AlertIcon({ alertType }: { alertType: Alert["alertType"] }) {
  if (alertType === "policy_violation" || alertType === "off_platform" || alertType === "inappropriate_behavior") {
    return (
      <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    );
  }
  if (alertType === "high_non_work_activity" || alertType === "non_work_activity") {
    return (
      <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
        <polyline points="17 18 23 18 23 12" />
      </svg>
    );
  }
  if (alertType === "session_idle" || alertType === "inactivity") {
    return (
      <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    );
  }
  if (alertType === "long_break" || alertType === "break_overtime") {
    return (
      <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 8h1a4 4 0 010 8h-1" />
        <path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" />
        <line x1="6" y1="1" x2="6" y2="4" />
        <line x1="10" y1="1" x2="10" y2="4" />
        <line x1="14" y1="1" x2="14" y2="4" />
      </svg>
    );
  }
  if (alertType === "late_clock_in") {
    return (
      <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
        <polyline points="12 14 12 17 14 17" />
      </svg>
    );
  }
  return (
    <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

export default function AlertsPage() {
  const router = useRouter();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [page, setPage] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const fetchAlerts = useCallback(async (pageIndex: number) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await getAlerts(false, PAGE_SIZE, pageIndex * PAGE_SIZE);
      setAlerts(data.alerts);
      setTotal(data.total);
      setUnreadCount(data.unreadCount);
    } catch {
      setError("Failed to load alerts. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts(page);
  }, [fetchAlerts, page]);

  const handleMarkAllRead = async () => {
    const unreadIds = alerts.filter((a) => !a.isRead).map((a) => a.id);
    if (unreadIds.length === 0) return;
    try {
      await markAlertsRead(unreadIds);
      setUnreadCount((prev) => Math.max(0, prev - unreadIds.length));
      setAlerts((prev) => prev.map((a) => ({ ...a, isRead: true })));
    } catch {
      // silently ignore
    }
  };

  // Navigate to the evidence behind the alert and mark it read.
  const handleAlertClick = (alert: Alert) => {
    if (!alert.isRead) {
      markAlertsRead([alert.id]).catch(() => {});
      setAlerts((prev) => prev.map((a) => (a.id === alert.id ? { ...a, isRead: true } : a)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    }
    router.push(alertEvidenceUrl(alert));
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const filteredAlerts = alerts.filter((a) => {
    if (severityFilter !== "all" && a.severity !== severityFilter) return false;
    if (typeFilter !== "all" && a.alertType !== typeFilter) return false;
    return true;
  });

  const uniqueTypes = Array.from(new Set(alerts.map((a) => a.alertType)));

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/admin/dashboard"
              className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 5l-7 7 7 7" />
              </svg>
              Dashboard
            </Link>
            <span className="text-gray-300">/</span>
            <span className="text-sm font-semibold text-gray-900">All Alerts</span>
          </div>
          <div className="flex items-center gap-3">
            {unreadCount > 0 && (
              <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full bg-red-100 text-red-600 text-xs font-semibold">
                {unreadCount} unread
              </span>
            )}
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors"
              >
                Mark page as read
              </button>
            )}
            <button
              type="button"
              onClick={() => fetchAlerts(page)}
              className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
              </svg>
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* Stats row */}
        <div className="flex items-center gap-6 mb-6">
          <div className="text-sm text-gray-500">
            <span className="font-semibold text-gray-900">{total}</span> total alerts
          </div>
          <div className="text-sm text-gray-500">
            Page <span className="font-semibold text-gray-900">{page + 1}</span> of{" "}
            <span className="font-semibold text-gray-900">{Math.max(1, totalPages)}</span>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-4">
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="all">All severities</option>
            <option value="severe">Severe</option>
            <option value="alert">Alert</option>
            <option value="warning">Warning</option>
            <option value="quality">Quality</option>
          </select>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="all">All types</option>
            {uniqueTypes.map((t) => (
              <option key={t} value={t}>
                {ALERT_TYPE_LABELS[t] ?? t}
              </option>
            ))}
          </select>

          {(severityFilter !== "all" || typeFilter !== "all") && (
            <button
              type="button"
              onClick={() => { setSeverityFilter("all"); setTypeFilter("all"); }}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Content */}
        {error ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <svg className="w-8 h-8 text-red-300 mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            <p className="text-sm text-gray-500 mb-3">{error}</p>
            <button
              type="button"
              onClick={() => fetchAlerts(page)}
              className="text-xs font-medium text-blue-600 hover:text-blue-800"
            >
              Try again
            </button>
          </div>
        ) : isLoading ? (
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="px-5 py-4 flex gap-4 animate-pulse">
                <div className="w-4 h-4 bg-gray-100 rounded mt-0.5 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-gray-100 rounded w-1/4" />
                  <div className="h-3 bg-gray-100 rounded w-3/4" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredAlerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <svg className="w-10 h-10 text-gray-200 mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 01-3.46 0" />
            </svg>
            <p className="text-sm text-gray-400">No alerts found</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="px-5 py-3 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Severity</th>
                  <th className="px-5 py-3 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Type</th>
                  <th className="px-5 py-3 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wide">VA</th>
                  <th className="px-5 py-3 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Message</th>
                  <th className="px-5 py-3 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wide w-44">Time</th>
                  <th className="px-5 py-3 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wide w-16">Status</th>
                  <th className="px-5 py-3 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wide w-28">Evidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredAlerts.map((alert) => (
                  <tr
                    key={alert.id}
                    onClick={() => handleAlertClick(alert)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleAlertClick(alert);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    className={`${!alert.isRead ? "bg-blue-50/30" : ""} hover:bg-gray-50/50 focus:bg-blue-50/50 focus:outline-none transition-colors cursor-pointer group`}
                  >
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold border ${SEVERITY_STYLES[alert.severity] ?? ""}`}
                      >
                        <span className={SEVERITY_STYLES[alert.severity]?.split(" ")[0] ?? "text-gray-500"}>
                          <AlertIcon alertType={alert.alertType} />
                        </span>
                        {SEVERITY_LABELS[alert.severity] ?? alert.severity.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-xs text-gray-600">
                        {ALERT_TYPE_LABELS[alert.alertType] ?? alert.alertType}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-xs text-gray-700 font-medium">
                        {alert.vaEmail ?? "—"}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-xs text-gray-700 leading-snug max-w-xl">{alert.message}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <div>
                        <p className="text-xs text-gray-700">{absoluteTime(alert.createdAt)}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">{relativeTime(alert.createdAt)}</p>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      {alert.isRead ? (
                        <span className="text-[10px] text-gray-400 font-medium">Read</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] text-blue-600 font-semibold">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                          New
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity">
                        {alert.screenshotId ? "View screenshot" : "View activity"}
                        <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M9 18l6-6-6-6" />
                        </svg>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-5">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0 || isLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              Previous
            </button>

            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(7, totalPages) }).map((_, i) => {
                let pageNum: number;
                if (totalPages <= 7) {
                  pageNum = i;
                } else if (page < 4) {
                  pageNum = i < 5 ? i : i === 5 ? -1 : totalPages - 1;
                } else if (page >= totalPages - 4) {
                  pageNum = i === 0 ? 0 : i === 1 ? -1 : totalPages - (7 - i);
                } else {
                  if (i === 0) pageNum = 0;
                  else if (i === 1) pageNum = -1;
                  else if (i === 5) pageNum = -1;
                  else if (i === 6) pageNum = totalPages - 1;
                  else pageNum = page + (i - 3);
                }

                if (pageNum === -1) {
                  return <span key={i} className="text-xs text-gray-400 px-1">…</span>;
                }

                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setPage(pageNum)}
                    disabled={isLoading}
                    className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${
                      page === pageNum
                        ? "bg-blue-600 text-white"
                        : "text-gray-600 hover:bg-gray-100 border border-gray-200"
                    }`}
                  >
                    {pageNum + 1}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1 || isLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
