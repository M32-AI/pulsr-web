/**
 * Client-side role permissions for WingWatch.
 *
 * Mirrors the server's rules in pulsr-backend/middleware/authorize-scope.ts.
 * This is presentation only — the API enforces the same rules independently, so
 * hiding a control here never becomes the sole protection (PRODUCT-25906).
 */

/**
 * Supervisors must never be shown screenshots (Serene, 2026-07-28). They get
 * activity signals — "likely off track", "likely inactive", productivity scores
 * and categories — but never the screen images themselves.
 */
export function canViewScreenshots(role: string | undefined): boolean {
  return role === "admin" || role === "manager";
}
