/**
 * Extract client IP from request headers.
 *
 * On Vercel, the client IP is available via:
 * 1. x-forwarded-for (first IP in comma-separated list)
 * 2. x-real-ip (fallback)
 * 3. req.socket.remoteAddress (final fallback, may be Vercel edge IP)
 *
 * References:
 * - https://vercel.com/docs/edge-network/headers#x-forwarded-for
 * - https://vercel.com/docs/edge-network/headers#x-real-ip
 *
 * The x-forwarded-for header is set by Vercel's edge and contains the
 * client's IP. When multiple proxies are involved, it's a comma-separated
 * list; the first IP is the client, later IPs are proxies.
 *
 * Safe fallback: When all headers are missing, return null.
 * The rate limiter treats null as "unknown IP" and denies the request
 * (fail closed).
 */

export function getClientIp(headers: Headers): string | null {
  // Try x-forwarded-for (Vercel primary)
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    // First IP in comma-separated list
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) return firstIp;
  }

  // Try x-real-ip (fallback)
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  // No IP available - fail closed
  return null;
}

/**
 * Normalize email for rate limiting.
 *
 * Email matching is case-insensitive and whitespace-insensitive.
 * This matches the audits.email CHECK constraint (lowercase, trimmed).
 *
 * Decision 3: 24-hour rule is per email, regardless of site.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
