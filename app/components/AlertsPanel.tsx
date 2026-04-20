"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getAlerts, markAlertsRead, type Alert } from "../lib/api";
import { usePushNotifications } from "../hooks/usePushNotifications";

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const SEVERITY_STYLES: Record<string, string> = {
  alert: "text-red-600 bg-red-50 border-red-200",
  warning: "text-orange-600 bg-orange-50 border-orange-200",
  quality: "text-blue-600 bg-blue-50 border-blue-200",
};

const SEVERITY_LABELS: Record<string, string> = {
  alert: "ALERT",
  warning: "WARNING",
  quality: "QUALITY",
};

function AlertIcon({ alertType }: { alertType: Alert["alertType"] }) {
  if (alertType === "policy_violation") {
    return (
      <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    );
  }
  if (alertType === "high_non_work_activity") {
    return (
      <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
        <polyline points="17 18 23 18 23 12" />
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

const PUSH_LABELS: Record<string, string> = {
  loading: "...",
  subscribed: "On",
  unsubscribed: "Off",
  denied: "Blocked",
  unsupported: "",
};

export default function AlertsPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [alertList, setAlertList] = useState<Alert[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { state: pushState, toggle: togglePush } = usePushNotifications();

  const fetchAlerts = useCallback(async () => {
    try {
      const data = await getAlerts(false, 50);
      setAlertList(data.alerts);
      setUnreadCount(data.unreadCount);
    } catch {
      // silently ignore — non-critical feature
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
    pollRef.current = setInterval(fetchAlerts, 30_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchAlerts]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const handleOpen = () => {
    setIsOpen(true);
    fetchAlerts();
  };

  const handleClose = async () => {
    setIsOpen(false);
    const unreadIds = alertList.filter((a) => !a.isRead).map((a) => a.id);
    if (unreadIds.length > 0) {
      try {
        await markAlertsRead(unreadIds);
        setUnreadCount(0);
        setAlertList((prev) => prev.map((a) => ({ ...a, isRead: true })));
      } catch {
        // silently ignore
      }
    }
  };

  const handleMarkAllRead = async () => {
    const unreadIds = alertList.filter((a) => !a.isRead).map((a) => a.id);
    if (unreadIds.length === 0) return;
    try {
      await markAlertsRead(unreadIds);
      setUnreadCount(0);
      setAlertList((prev) => prev.map((a) => ({ ...a, isRead: true })));
    } catch {
      // silently ignore
    }
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={isOpen ? handleClose : handleOpen}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 hover:text-gray-900 transition-colors"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 01-3.46 0" />
        </svg>
        Alerts
        {unreadCount > 0 && (
          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-8 z-50 w-96 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span className="text-sm font-semibold text-gray-900">
              Alerts {alertList.length > 0 && `(${alertList.length})`}
            </span>
            <div className="flex items-center gap-3">
              {pushState !== "unsupported" && (
                <button
                  type="button"
                  onClick={togglePush}
                  disabled={pushState === "loading" || pushState === "denied"}
                  title={pushState === "denied" ? "Notifications blocked in browser settings" : "Toggle push notifications"}
                  className={`inline-flex items-center gap-1 text-[11px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    pushState === "subscribed"
                      ? "text-green-600 hover:text-green-800"
                      : pushState === "denied"
                      ? "text-gray-400 cursor-not-allowed"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 01-3.46 0" />
                  </svg>
                  {PUSH_LABELS[pushState]}
                </button>
              )}
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors"
                >
                  Mark all read
                </button>
              )}
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {isLoading ? (
              <div className="px-4 py-6 text-center text-xs text-gray-400">Loading...</div>
            ) : alertList.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-gray-400">No alerts</div>
            ) : (
              <ul className="divide-y divide-gray-50">
                {alertList.map((alert) => (
                  <li
                    key={alert.id}
                    className={`px-4 py-3 flex gap-3 items-start ${!alert.isRead ? "bg-gray-50" : ""}`}
                  >
                    <span className={`mt-0.5 ${SEVERITY_STYLES[alert.severity]?.split(" ")[0] ?? "text-gray-500"}`}>
                      <AlertIcon alertType={alert.alertType} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border ${SEVERITY_STYLES[alert.severity] ?? ""}`}
                        >
                          {SEVERITY_LABELS[alert.severity] ?? alert.severity.toUpperCase()}
                        </span>
                        <span className="text-[10px] text-gray-400">{relativeTime(alert.createdAt)}</span>
                      </div>
                      <p className="text-xs text-gray-700 leading-snug">{alert.message}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
