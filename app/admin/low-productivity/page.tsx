"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/app/store/authStore";
import {
  getLowProductivityScreenshots,
  type LowProductivityScreenshot,
  type LowProductivityResponse,
} from "@/app/lib/api";

const PAGE_SIZE = 25;

const THRESHOLD_OPTIONS = [
  { label: "Score < 20 (Critical)", value: 20 },
  { label: "Score < 30", value: 30 },
  { label: "Score < 40 (Default)", value: 40 },
  { label: "Score < 50", value: 50 },
  { label: "Score < 60", value: 60 },
];

function scoreColor(score: number | null) {
  if (score === null) return "bg-gray-100 text-gray-500";
  if (score < 20) return "bg-red-600 text-white";
  if (score < 40) return "bg-red-100 text-red-700";
  if (score < 60) return "bg-amber-100 text-amber-700";
  return "bg-orange-100 text-orange-700";
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function formatJsonResponse(raw: string | null) {
  if (!raw) return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

// ── Prompt & Response Modal ──────────────────────────────────────────────────

function PromptModal({
  screenshot,
  onClose,
}: {
  screenshot: LowProductivityScreenshot;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const [tab, setTab] = useState<"prompt" | "response">("prompt");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">AI Prompt & Response</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {screenshot.logModel ?? screenshot.modelUsed ?? "Unknown model"} ·{" "}
              {screenshot.promptVersion ?? "v1"} ·{" "}
              {screenshot.logTokensUsed != null ? `${screenshot.logTokensUsed} tokens` : "—"}{" "}
              {screenshot.durationMs != null ? `· ${(screenshot.durationMs / 1000).toFixed(1)}s` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md text-gray-400 hover:bg-gray-100"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-gray-100 shrink-0">
          {(["prompt", "response"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-5 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                tab === t
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-400 hover:text-gray-600"
              }`}
            >
              {t === "prompt" ? "System Prompt" : "Raw AI Response"}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === "prompt" ? (
            screenshot.systemPrompt ? (
              <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono bg-gray-50 rounded-lg p-4 leading-relaxed">
                {screenshot.systemPrompt}
              </pre>
            ) : (
              <p className="text-sm text-gray-400 text-center py-10">
                No prompt logged for this screenshot (captured before logging was enabled).
              </p>
            )
          ) : (
            screenshot.rawResponse ? (
              <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono bg-gray-50 rounded-lg p-4 leading-relaxed">
                {formatJsonResponse(screenshot.rawResponse)}
              </pre>
            ) : (
              <p className="text-sm text-gray-400 text-center py-10">
                No raw response logged for this screenshot.
              </p>
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ── Screenshot Lightbox ──────────────────────────────────────────────────────

function Lightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <img
        src={src}
        alt={alt}
        className="max-w-full max-h-full rounded-lg shadow-2xl object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ── Table Row ────────────────────────────────────────────────────────────────

function ScreenshotRow({
  row,
  index,
  offset,
  onViewPrompt,
}: {
  row: LowProductivityScreenshot;
  index: number;
  offset: number;
  onViewPrompt: (row: LowProductivityScreenshot) => void;
}) {
  const [lightbox, setLightbox] = useState(false);

  return (
    <>
      <tr className="hover:bg-gray-50/60 transition-colors">
        {/* Row number */}
        <td className="px-4 py-3 text-xs text-gray-400 text-center w-10">{offset + index + 1}</td>

        {/* Screenshot thumbnail */}
        <td className="px-4 py-3 w-20">
          {row.presignedUrl ? (
            <button
              type="button"
              onClick={() => setLightbox(true)}
              className="block w-16 h-12 rounded-md overflow-hidden border border-gray-200 hover:border-blue-400 transition-colors"
            >
              <img
                src={row.presignedUrl}
                alt="screenshot"
                className="w-full h-full object-cover"
              />
            </button>
          ) : (
            <div className="w-16 h-12 rounded-md bg-gray-100 flex items-center justify-center">
              <svg className="w-4 h-4 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </div>
          )}
        </td>

        {/* VA */}
        <td className="px-4 py-3 max-w-[140px]">
          <p className="text-xs font-medium text-gray-800 truncate">{row.vaEmail}</p>
        </td>

        {/* Captured At */}
        <td className="px-4 py-3 whitespace-nowrap">
          <p className="text-xs text-gray-600">{formatDateTime(row.capturedAt)}</p>
        </td>

        {/* Score */}
        <td className="px-4 py-3 text-center">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold ${scoreColor(row.productivityScore)}`}>
            {row.productivityScore ?? "—"}
          </span>
        </td>

        {/* Category */}
        <td className="px-4 py-3 max-w-[130px]">
          {row.category ? (
            <>
              <p className="text-xs font-medium text-gray-700 truncate">{row.category}</p>
              {row.subcategory && (
                <p className="text-[10px] text-gray-400 truncate">{row.subcategory}</p>
              )}
            </>
          ) : (
            <span className="text-xs text-gray-300">—</span>
          )}
        </td>

        {/* Application */}
        <td className="px-4 py-3 max-w-[120px]">
          <p className="text-xs text-gray-600 truncate">{row.activeApplication ?? "—"}</p>
        </td>

        {/* Summary */}
        <td className="px-4 py-3 max-w-[200px]">
          <p className="text-xs text-gray-600 line-clamp-2">{row.summary ?? "—"}</p>
        </td>

        {/* Flags */}
        <td className="px-4 py-3 max-w-[160px]">
          {row.flags && row.flags.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {row.flags.slice(0, 3).map((f) => (
                <span
                  key={f}
                  className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-red-50 text-red-600 border border-red-100"
                >
                  {f.replace(/_/g, " ")}
                </span>
              ))}
              {row.flags.length > 3 && (
                <span className="text-[10px] text-gray-400">+{row.flags.length - 3}</span>
              )}
            </div>
          ) : (
            <span className="text-xs text-gray-300">—</span>
          )}
        </td>

        {/* Model */}
        <td className="px-4 py-3 max-w-[120px]">
          <p className="text-[10px] text-gray-500 font-mono truncate">
            {row.logModel ?? row.modelUsed ?? "—"}
          </p>
        </td>

        {/* Actions */}
        <td className="px-4 py-3">
          <button
            type="button"
            onClick={() => onViewPrompt(row)}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100 transition-colors"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            Prompt
          </button>
        </td>
      </tr>

      {lightbox && row.presignedUrl && (
        <Lightbox
          src={row.presignedUrl}
          alt={`Screenshot ${row.id}`}
          onClose={() => setLightbox(false)}
        />
      )}
    </>
  );
}

// ── Pagination ───────────────────────────────────────────────────────────────

function Pagination({
  total,
  offset,
  limit,
  onPageChange,
}: {
  total: number;
  offset: number;
  limit: number;
  onPageChange: (offset: number) => void;
}) {
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit);

  if (totalPages <= 1) return null;

  const pages: (number | "...")[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (currentPage > 3) pages.push("...");
    for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
      pages.push(i);
    }
    if (currentPage < totalPages - 2) pages.push("...");
    pages.push(totalPages);
  }

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-white">
      <p className="text-xs text-gray-400">
        Showing {offset + 1}–{Math.min(offset + limit, total)} of {total}
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={currentPage === 1}
          onClick={() => onPageChange((currentPage - 2) * limit)}
          className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        {pages.map((p, i) =>
          p === "..." ? (
            <span key={`ellipsis-${i}`} className="w-7 h-7 flex items-center justify-center text-xs text-gray-400">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onPageChange((p - 1) * limit)}
              className={`w-7 h-7 flex items-center justify-center rounded text-xs font-medium transition-colors ${
                p === currentPage
                  ? "bg-blue-600 text-white"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {p}
            </button>
          )
        )}
        <button
          type="button"
          disabled={currentPage === totalPages}
          onClick={() => onPageChange(currentPage * limit)}
          className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function LowProductivityPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuthStore();

  const [threshold, setThreshold] = useState(40);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<LowProductivityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptModal, setPromptModal] = useState<LowProductivityScreenshot | null>(null);

  // Admin-only guard
  useEffect(() => {
    if (authLoading) return;
    if (user && user.role !== "admin") {
      router.replace("/unauthorized");
    }
  }, [authLoading, user, router]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getLowProductivityScreenshots(threshold, offset);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [threshold, offset]);

  useEffect(() => {
    if (!authLoading && user?.role === "admin") {
      fetchData();
    }
  }, [authLoading, user, fetchData]);

  const handleThresholdChange = (newThreshold: number) => {
    setThreshold(newThreshold);
    setOffset(0);
  };

  const handlePageChange = (newOffset: number) => {
    setOffset(newOffset);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (authLoading || (!user && !authLoading)) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (user?.role !== "admin") return null;

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top bar */}
      <div className="h-12 bg-white border-b border-gray-200 flex items-center justify-between px-5 shrink-0">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/dashboard"
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
            Dashboard
          </Link>
          <span className="text-gray-300">/</span>
          <span className="text-sm font-semibold text-gray-900">Low Productivity Screenshots</span>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 border border-red-100 px-2.5 py-1 text-xs font-semibold text-red-600">
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          Admin Only
        </span>
      </div>

      <div className="flex-1 p-6 max-w-screen-2xl mx-auto w-full">
        {/* Page title + stats */}
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Low Productivity Review</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              Screenshots where the AI assigned a productivity score below the threshold — review the image, AI output, and the exact prompt used.
            </p>
          </div>
          {data && (
            <div className="text-right">
              <p className="text-2xl font-bold text-red-500">{data.total.toLocaleString()}</p>
              <p className="text-xs text-gray-400">total matching</p>
            </div>
          )}
        </div>

        {/* Filter bar */}
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 mb-4 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500 shrink-0">Score threshold:</span>
            <select
              value={threshold}
              onChange={(e) => handleThresholdChange(Number(e.target.value))}
              className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
            >
              {THRESHOLD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="w-px h-4 bg-gray-200" />
          <p className="text-xs text-gray-400">
            Showing screenshots with productivity score &lt; <span className="font-semibold text-gray-600">{threshold}</span>
          </p>
          <div className="ml-auto">
            <button
              type="button"
              onClick={fetchData}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              <svg className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              Refresh
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-4 py-3 mb-4">
            <svg className="w-4 h-4 text-red-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            <p className="text-sm text-red-600">{error}</p>
            <button type="button" onClick={fetchData} className="ml-auto text-xs text-red-500 underline hover:text-red-600">Retry</button>
          </div>
        )}

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className="px-4 py-3 text-center text-[10px] font-semibold text-gray-400 uppercase tracking-wide w-10">#</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Screenshot</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wide">VA</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">Captured At</th>
                  <th className="px-4 py-3 text-center text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Score</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Category</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Application</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wide">AI Summary</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Flags</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Model</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Prompt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 11 }).map((_, j) => (
                        <td key={j} className="px-4 py-4">
                          <div className="h-4 bg-gray-100 rounded animate-pulse" style={{ width: j === 0 ? "24px" : j === 1 ? "64px" : "80%" }} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : data?.screenshots.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-16 text-center">
                      <svg className="w-10 h-10 text-gray-200 mx-auto mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <polyline points="21 15 16 10 5 21" />
                      </svg>
                      <p className="text-sm text-gray-400 font-medium">No screenshots found</p>
                      <p className="text-xs text-gray-300 mt-1">Try increasing the score threshold</p>
                    </td>
                  </tr>
                ) : (
                  data?.screenshots.map((row, i) => (
                    <ScreenshotRow
                      key={row.id}
                      row={row}
                      index={i}
                      offset={offset}
                      onViewPrompt={setPromptModal}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>

          {data && (
            <Pagination
              total={data.total}
              offset={offset}
              limit={PAGE_SIZE}
              onPageChange={handlePageChange}
            />
          )}
        </div>
      </div>

      {/* Prompt Modal */}
      {promptModal && (
        <PromptModal
          screenshot={promptModal}
          onClose={() => setPromptModal(null)}
        />
      )}
    </div>
  );
}
