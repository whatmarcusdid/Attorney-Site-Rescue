import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeEmail } from "./client-ip";

/**
 * Rate limit result types.
 *
 * The future endpoint can map these to UI states:
 * - allowed: proceed with audit
 * - ip_limited: show "Rate limited" screen (20/hour exceeded)
 * - email_limited: show "repeat visit within 24h" state
 * - store_unavailable: show error screen (Decision 2: fail closed)
 * - no_client_ip: internal error, fail closed
 */
export type RateLimitResult =
  | { allowed: true; reason: null }
  | {
      allowed: false;
      reason:
        | "ip_limited" // 20/hour exceeded
        | "email_limited" // 1/24h exceeded
        | "store_unavailable" // DB error (fail closed)
        | "no_client_ip"; // Missing IP (fail closed)
    };

/**
 * Rate limit configuration.
 */
const RATE_LIMITS = {
  ip: {
    limit: 20,
    windowMs: 60 * 60 * 1000, // 1 hour
  },
  email: {
    limit: 1,
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
  },
} as const;

/**
 * Check rate limits for an audit request.
 *
 * Checks both IP-based (20/hour) and email-based (1/24h) limits.
 * Uses Postgres rate_limit_events table from B2 migrations.
 *
 * Decision 2: Fail closed.
 * If the store is unavailable, denies the request and logs the failure.
 *
 * Decision 3: 24-hour rule.
 * 1 audit per email (normalized) per 24 hours, regardless of site.
 *
 * Atomicity:
 * Uses atomic Postgres function (check_and_record_rate_limit) with
 * pg_advisory_xact_lock to prevent race conditions. Two concurrent
 * requests cannot both pass the same limit.
 *
 * @param clientIp - Client IP address (from x-forwarded-for or x-real-ip)
 * @param email - User email (will be normalized)
 * @returns RateLimitResult indicating whether request is allowed
 */
export async function checkRateLimit(
  clientIp: string | null,
  email: string,
): Promise<RateLimitResult> {
  // Decision 2: Fail closed on missing IP
  if (!clientIp) {
    console.error("[rate-limit] No client IP available, denying request");
    return { allowed: false, reason: "no_client_ip" };
  }

  const normalizedEmail = normalizeEmail(email);

  try {
    const supabase = createAdminClient();

    // Check IP limit (20/hour)
    const ipResult = await checkIpLimit(supabase, clientIp);
    if (!ipResult.allowed) return ipResult;

    // Check email limit (1/24h)
    const emailResult = await checkEmailLimit(supabase, normalizedEmail);
    if (!emailResult.allowed) return emailResult;

    // All checks passed
    return { allowed: true, reason: null };
  } catch (error) {
    // Decision 2: Fail closed on store error
    console.error(
      "[rate-limit] Store error, denying request (fail closed):",
      error,
    );
    return { allowed: false, reason: "store_unavailable" };
  }
}

/**
 * Check IP-based rate limit (20 audits per hour).
 *
 * Uses atomic Postgres function (from migration 20261126000003).
 * Advisory lock ensures concurrent requests don't both pass.
 */
async function checkIpLimit(
  supabase: ReturnType<typeof createAdminClient>,
  clientIp: string,
): Promise<RateLimitResult> {
  const limiterKey = `ip:${clientIp}`;

  const { data, error } = await supabase.rpc("check_and_record_rate_limit", {
    p_limiter_key: limiterKey,
    p_limit_type: "ip_hourly",
    p_limit: RATE_LIMITS.ip.limit,
    p_window_ms: RATE_LIMITS.ip.windowMs,
    p_client_ip: clientIp,
  });

  if (error) {
    console.error("[rate-limit] IP limit check failed:", error);
    throw error;
  }

  const result = data as {
    allowed: boolean;
    reason: string | null;
    count: number;
    limit: number;
  };

  if (!result.allowed) {
    console.warn(
      `[rate-limit] IP limit exceeded: ${clientIp} (${result.count}/${result.limit})`,
    );
    return { allowed: false, reason: "ip_limited" };
  }

  return { allowed: true, reason: null };
}

/**
 * Check email-based rate limit (1 audit per 24 hours).
 *
 * Decision 3: Per email, regardless of site.
 * Uses atomic Postgres function (from migration 20261126000003).
 * Advisory lock ensures concurrent requests don't both pass.
 */
async function checkEmailLimit(
  supabase: ReturnType<typeof createAdminClient>,
  email: string,
): Promise<RateLimitResult> {
  const limiterKey = `email:${email}`;

  const { data, error } = await supabase.rpc("check_and_record_rate_limit", {
    p_limiter_key: limiterKey,
    p_limit_type: "email_daily",
    p_limit: RATE_LIMITS.email.limit,
    p_window_ms: RATE_LIMITS.email.windowMs,
    p_email: email,
  });

  if (error) {
    console.error("[rate-limit] Email limit check failed:", error);
    throw error;
  }

  const result = data as {
    allowed: boolean;
    reason: string | null;
    count: number;
    limit: number;
  };

  if (!result.allowed) {
    console.warn(
      `[rate-limit] Email limit exceeded: ${email} (${result.count}/${result.limit})`,
    );
    return { allowed: false, reason: "email_limited" };
  }

  return { allowed: true, reason: null };
}

/**
 * Link a rate limit event to an audit after audit creation.
 *
 * Call this after the audit is successfully created.
 * This is optional; rate limiting works without linking to audits.
 *
 * @param clientIp - Client IP (used to find the event)
 * @param email - User email (normalized)
 * @param auditId - Audit ID to link
 */
export async function linkRateLimitEventToAudit(
  clientIp: string,
  email: string,
  auditId: string,
): Promise<void> {
  try {
    const supabase = createAdminClient();
    const normalizedEmail = normalizeEmail(email);

    // Update the most recent events for this IP and email
    // (the ones we just created in checkRateLimit)
    const recentTime = new Date(Date.now() - 10000); // Last 10 seconds

    await supabase
      .from("rate_limit_events")
      .update({ audit_id: auditId })
      .eq("limiter_key", `ip:${clientIp}`)
      .gte("event_time", recentTime.toISOString())
      .is("audit_id", null);

    await supabase
      .from("rate_limit_events")
      .update({ audit_id: auditId })
      .eq("limiter_key", `email:${normalizedEmail}`)
      .gte("event_time", recentTime.toISOString())
      .is("audit_id", null);
  } catch (error) {
    // Non-critical: linking is best-effort
    console.warn("[rate-limit] Failed to link event to audit:", error);
  }
}
