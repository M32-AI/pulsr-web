"use client";

import { useCallback, useEffect, useState } from "react";
import { getVaReports, type VaReport, type VaReportType } from "../lib/api";

/**
 * VA-submitted reports from the desktop app's 3-dot menu (PRODUCT-27087):
 * call in sick, report an outage, incorrect shift, incident response,
 * feedback. These used to be console.log'd and discarded entirely — this
 * panel is the other half of that fix: without somewhere to actually see
 * them, a durably-stored report is still effectively invisible. No
 * unread/read affordance here by design — there's no mark-as-read action
 * yet, so showing one would imply an interaction that doesn't exist.
 */

const TYPE_LABEL: Record<VaReportType, string> = {
  call_in_sick: "Call in sick",
  power_outage: "Power/Internet outage",
  incorrect_shift: "Incorrect shift",
  incident_response: "Incident response",
  feedback: "Feedback",
};

const TYPE_TONE: Record<VaReportType, string> = {
  call_in_sick: "bg-amber-50 text-amber-600 border-amber-100",
  power_outage: "bg-amber-50 text-amber-600 border-amber-100",
  incorrect_shift: "bg-gray-50 text-gray-500 border-gray-200",
  incident_response: "bg-red-50 text-red-600 border-red-100",
  feedback: "bg-blue-50 text-blue-600 border-blue-100",
};

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function VaReportsPanel({ vaId }: { vaId: string }) {
  const [reports, setReports] = useState<VaReport[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setReports(await getVaReports(vaId));
    } catch {
      setError(true);
      setReports(null);
    } finally {
      setLoading(false);
    }
  }, [vaId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="mx-6 mb-4 border border-gray-200 rounded-xl bg-white px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
          VA Reports
        </h2>
        {reports && reports.length > 0 && (
          <span className="text-[10px] text-gray-400">
            {reports.length} submitted
          </span>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-8">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && error && (
        <p className="py-6 text-center text-sm text-red-400">Failed to load reports</p>
      )}

      {!loading && !error && reports && reports.length === 0 && (
        <p className="py-6 text-center text-sm text-gray-400">No reports submitted</p>
      )}

      {!loading && !error && reports && reports.length > 0 && (
        <ul className="space-y-2">
          {reports.map((r) => (
            <li key={r.id} className="border border-gray-100 rounded-lg px-3 py-2.5">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${TYPE_TONE[r.type]}`}
                >
                  {TYPE_LABEL[r.type]}
                </span>
                <span className="text-[10px] text-gray-400 shrink-0">
                  {formatTimestamp(r.createdAt)}
                </span>
              </div>
              <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">{r.message}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
