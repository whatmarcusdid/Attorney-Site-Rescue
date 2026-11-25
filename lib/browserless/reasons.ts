export const HOME_PAGE_FETCH_REASON_CODES = [
  "FETCH_TIMEOUT",
  "RESPONSE_TOO_LARGE",
  "FETCH_FAILED",
  "PROVIDER_ERROR",
] as const;

export type HomePageFetchReasonCode =
  (typeof HOME_PAGE_FETCH_REASON_CODES)[number];

const CUSTOMER_MESSAGES: Record<HomePageFetchReasonCode, string> = {
  FETCH_TIMEOUT: "This website could not be reached.",
  RESPONSE_TOO_LARGE: "This website cannot be scanned.",
  FETCH_FAILED: "This website could not be reached.",
  PROVIDER_ERROR: "This website could not be reached.",
};

export function customerMessageForFetch(
  code: HomePageFetchReasonCode,
): string {
  return CUSTOMER_MESSAGES[code];
}

/** Distinct from URL-safety unsupported copy. Internal codes stay off this string. */
export const ACCESS_DENIED_CUSTOMER_MESSAGE =
  "This website's security settings are preventing us from completing a scan";

const TARGET_ACCESS_DENIED_STATUSES = new Set([401, 403]);

export function isTargetAccessDenied(
  failureType?: string | null,
  httpStatus?: number | null,
): boolean {
  return (
    failureType === "NON_2XX_STATUS" &&
    httpStatus != null &&
    TARGET_ACCESS_DENIED_STATUSES.has(httpStatus)
  );
}

export function terminalStateForHomeFetchFailure(
  diagnostic: Pick<HomeFetchDiagnostic, "failureType" | "httpStatus">,
): "unsupported" | "failed" {
  return isTargetAccessDenied(diagnostic.failureType, diagnostic.httpStatus)
    ? "unsupported"
    : "failed";
}

export function customerMessageForHomeFetchFailure(
  diagnostic: Pick<
    HomeFetchDiagnostic,
    "reasonCode" | "failureType" | "httpStatus"
  >,
): string {
  if (isTargetAccessDenied(diagnostic.failureType, diagnostic.httpStatus)) {
    return ACCESS_DENIED_CUSTOMER_MESSAGE;
  }
  if (
    (HOME_PAGE_FETCH_REASON_CODES as readonly string[]).includes(
      diagnostic.reasonCode,
    )
  ) {
    return customerMessageForFetch(
      diagnostic.reasonCode as HomePageFetchReasonCode,
    );
  }
  return CUSTOMER_MESSAGES.FETCH_FAILED;
}

export const HOME_FETCH_FAILURE_TYPES = [
  "TIMEOUT",
  "NON_2XX_STATUS",
  "NETWORK_ERROR",
  "PROVIDER_ERROR",
  "SAFETY_REJECTED",
] as const;

export type HomeFetchFailureType = (typeof HOME_FETCH_FAILURE_TYPES)[number];

export interface HomeFetchDiagnostic {
  reasonCode: string;
  failureType: HomeFetchFailureType;
  httpStatus?: number;
  providerMessage?: string;
}

const SAFETY_REASON_CODES = new Set([
  "INVALID_URL",
  "DISALLOWED_PROTOCOL",
  "DISALLOWED_PORT",
  "CREDENTIALS_IN_URL",
  "BLOCKED_HOST",
  "BLOCKED_ADDRESS",
  "DNS_FAILED",
  "REDIRECT_BLOCKED",
  "TOO_MANY_REDIRECTS",
  "PROHIBITED_CONTENT",
]);

export function inferHomeFetchFailureType(
  reasonCode: string,
): HomeFetchFailureType {
  if (reasonCode === "FETCH_TIMEOUT") return "TIMEOUT";
  if (reasonCode === "FETCH_FAILED") return "NON_2XX_STATUS";
  if (SAFETY_REASON_CODES.has(reasonCode)) return "SAFETY_REJECTED";
  return "PROVIDER_ERROR";
}

/**
 * Home-page scan outcomes. "complete" is the only successful 200 result.
 * Partial covers a stopped check (non-200, timeout, oversized HTML, or a
 * navigation that destroyed the execution context) and is returned, not thrown.
 */
export const HOME_SCAN_OUTCOMES = [
  "complete",
  "partial",
  "rejected",
  "config_failure",
] as const;

export type HomeScanOutcome = (typeof HOME_SCAN_OUTCOMES)[number];

export const HOME_SCAN_PARTIAL_REASONS = [
  "HTTP_202",
  "HTTP_403",
  "HTTP_5XX",
  "HTTP_NON_200",
  "CONNECT_TIMEOUT",
  "LOAD_TIMEOUT",
  "SESSION_TIMEOUT",
  "EXECUTION_CONTEXT_DESTROYED",
  "RESPONSE_TOO_LARGE",
  "TOO_MANY_REDIRECTS",
  "LOAD_FAILED",
  "PROVIDER_ERROR",
  "FIRST_RESULTS_BUDGET",
] as const;

export type HomeScanPartialReason = (typeof HOME_SCAN_PARTIAL_REASONS)[number];

export function partialReasonForHttpStatus(status: number): HomeScanPartialReason {
  if (status === 202) return "HTTP_202";
  if (status === 403) return "HTTP_403";
  if (status >= 500 && status <= 599) return "HTTP_5XX";
  return "HTTP_NON_200";
}

/** Reuses the existing generic sentences. Does not add a new public sentence. */
export function customerMessageForPartial(input: {
  reason: string;
  httpStatus?: number;
}): string {
  if (input.httpStatus === 401 || input.httpStatus === 403) {
    return ACCESS_DENIED_CUSTOMER_MESSAGE;
  }
  if (
    input.reason === "RESPONSE_TOO_LARGE" ||
    input.reason === "TOO_MANY_REDIRECTS"
  ) {
    return CUSTOMER_MESSAGES.RESPONSE_TOO_LARGE;
  }
  if (
    input.reason === "CONNECT_TIMEOUT" ||
    input.reason === "LOAD_TIMEOUT" ||
    input.reason === "SESSION_TIMEOUT" ||
    input.reason === "FIRST_RESULTS_BUDGET"
  ) {
    return CUSTOMER_MESSAGES.FETCH_TIMEOUT;
  }
  return CUSTOMER_MESSAGES.FETCH_FAILED;
}

export function redactProviderSecrets(text: string): string {
  let next = text.replace(/([?&]token=)[^&\s]+/gi, "$1[redacted]");
  next = next.replace(/(\btoken=)[^&\s]+/gi, "$1[redacted]");
  const key = process.env.BROWSERLESS_API_KEY;
  if (key) {
    next = next.split(key).join("[redacted]");
    const encoded = encodeURIComponent(key);
    if (encoded !== key) {
      next = next.split(encoded).join("[redacted]");
    }
  }
  return next;
}
