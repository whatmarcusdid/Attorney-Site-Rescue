/**
 * Shared-store rate limiter backed by Postgres.
 *
 * Replaces the in-process limiter (which was never ported to this repo).
 * Uses the rate_limit_events table from B2 migrations.
 *
 * Limits:
 * - IP: 20 audits per rolling hour
 * - Email: 1 audit per 24 hours (normalized: lowercase, trimmed)
 *
 * Decision 2 (Marcus approved): Fail closed.
 * If the rate-limit store is unavailable, the limiter denies the request
 * (must not let it through) and logs the failure safely.
 *
 * Decision 3 (Marcus approved): 24-hour rule.
 * 1 audit per email (normalized) per 24 hours, regardless of site.
 */

export { checkRateLimit, type RateLimitResult } from "./postgres-limiter";
export { getClientIp } from "./client-ip";
