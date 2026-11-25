import type { HomeFetchDiagnostic } from "../browserless/reasons";
import { CRAWLER_INFO_URL, SUPPORT_EMAIL } from "../identity";
import { URL_SAFETY_BOUNDS } from "../url-safety/bounds";

/**
 * Home-fetch retry planner.
 *
 * Exactly one automatic retry is planned, and only for two classes:
 *
 *   - `access_denied` — the response was 401 or 403. The plan includes a
 *     short delay and a varied User-Agent that is still this product's
 *     crawler.
 *   - `transient` — timeout, network, provider, or 5xx. The plan includes a
 *     short delay.
 *   - `none` — safety rejections and any other 4xx. A retry would not change
 *     the outcome.
 *
 * `MAX_AUTOMATIC_RETRIES` is the ceiling for the whole home fetch, not per
 * class. This module does not perform a retry. The synchronous home-page
 * scan makes one Browserless session and returns.
 */
export const MAX_AUTOMATIC_RETRIES = 1;

/** Delay before the single access-denied retry. */
export const ACCESS_DENIED_RETRY_DELAY_MS = 1_500;

/** Delay before the single transient retry. */
export const TRANSIENT_RETRY_DELAY_MS = 1_000;

/**
 * Varied crawler identity for the access-denied retry. The token stays a
 * placeholder. The varied part is the retry marker, not a browser disguise.
 */
export const RETRY_USER_AGENT = `AttorneySiteRescueBot/0.1-placeholder (retry; +${CRAWLER_INFO_URL}; ${SUPPORT_EMAIL})`;

export type HomeFetchRetryClass = "access_denied" | "transient" | "none";

function isServerError(status?: number | null): boolean {
  return status != null && status >= 500 && status < 600;
}

function isAccessDenied(status?: number | null): boolean {
  return status === 401 || status === 403;
}

export function classifyHomeFetchRetry(
  diagnostic: Pick<HomeFetchDiagnostic, "failureType" | "httpStatus">,
): HomeFetchRetryClass {
  if (diagnostic.failureType === "SAFETY_REJECTED") return "none";

  if (diagnostic.failureType === "NON_2XX_STATUS") {
    if (isAccessDenied(diagnostic.httpStatus)) return "access_denied";
    if (isServerError(diagnostic.httpStatus)) return "transient";
    return "none";
  }

  if (
    diagnostic.failureType === "TIMEOUT" ||
    diagnostic.failureType === "NETWORK_ERROR" ||
    diagnostic.failureType === "PROVIDER_ERROR"
  ) {
    return "transient";
  }

  return "none";
}

export interface RetryPlan {
  retry: boolean;
  delayMs: number;
  /** Set only for the access-denied varied-signature retry. */
  userAgent?: string;
}

/**
 * Decides whether a second attempt is allowed. `attemptsUsed` counts real
 * fetch attempts already made, so the first failure arrives with a value of 1.
 */
export function planHomeFetchRetry(
  diagnostic: Pick<HomeFetchDiagnostic, "failureType" | "httpStatus">,
  attemptsUsed: number,
): RetryPlan {
  if (attemptsUsed > MAX_AUTOMATIC_RETRIES) {
    return { retry: false, delayMs: 0 };
  }

  const retryClass = classifyHomeFetchRetry(diagnostic);

  if (retryClass === "access_denied") {
    return {
      retry: true,
      delayMs: ACCESS_DENIED_RETRY_DELAY_MS,
      userAgent: RETRY_USER_AGENT,
    };
  }

  if (retryClass === "transient") {
    return { retry: true, delayMs: TRANSIENT_RETRY_DELAY_MS };
  }

  return { retry: false, delayMs: 0 };
}

/**
 * Same plan as `planHomeFetchRetry`, except a retry is refused when the
 * delay plus another connect and another hard page-load would exceed the
 * remaining first-results budget.
 */
export function planHomeFetchRetryIfBudgetAllows(
  diagnostic: Pick<HomeFetchDiagnostic, "failureType" | "httpStatus">,
  attemptsUsed: number,
  remainingBudgetMs: number,
): RetryPlan {
  const plan = planHomeFetchRetry(diagnostic, attemptsUsed);
  if (!plan.retry) return plan;

  const nextAttemptMs =
    plan.delayMs +
    URL_SAFETY_BOUNDS.connectTimeoutMs +
    URL_SAFETY_BOUNDS.gotoHardTimeoutMs;
  if (nextAttemptMs > remainingBudgetMs) {
    return { retry: false, delayMs: 0 };
  }
  return plan;
}

/** A transient failure is the class a later manual retry could offer. */
export function allowsManualRetry(
  diagnostic: Pick<HomeFetchDiagnostic, "failureType" | "httpStatus">,
): boolean {
  return classifyHomeFetchRetry(diagnostic) === "transient";
}
