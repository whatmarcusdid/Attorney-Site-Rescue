/**
 * @jest-environment node
 */
import {
  allowsManualRetry,
  classifyHomeFetchRetry,
  MAX_AUTOMATIC_RETRIES,
  planHomeFetchRetry,
  planHomeFetchRetryIfBudgetAllows,
  RETRY_USER_AGENT,
} from "@/lib/scan/retry";
import { URL_SAFETY_BOUNDS } from "@/lib/url-safety/bounds";

describe("home-fetch retry classification", () => {
  it("permits exactly one automatic retry", () => {
    expect(MAX_AUTOMATIC_RETRIES).toBe(1);
  });

  it.each([401, 403])("classifies %s as access_denied", (httpStatus) => {
    expect(
      classifyHomeFetchRetry({ failureType: "NON_2XX_STATUS", httpStatus }),
    ).toBe("access_denied");
  });

  it.each([
    ["TIMEOUT", undefined],
    ["NETWORK_ERROR", undefined],
    ["PROVIDER_ERROR", undefined],
    ["NON_2XX_STATUS", 500],
    ["NON_2XX_STATUS", 503],
  ] as const)("classifies %s/%s as transient", (failureType, httpStatus) => {
    expect(classifyHomeFetchRetry({ failureType, httpStatus })).toBe(
      "transient",
    );
  });

  it.each([
    ["SAFETY_REJECTED", undefined],
    ["NON_2XX_STATUS", 404],
    ["NON_2XX_STATUS", 410],
  ] as const)("never retries %s/%s", (failureType, httpStatus) => {
    expect(classifyHomeFetchRetry({ failureType, httpStatus })).toBe("none");
    expect(planHomeFetchRetry({ failureType, httpStatus }, 1).retry).toBe(
      false,
    );
  });

  it("varies the request signature for the access-denied retry", () => {
    const plan = planHomeFetchRetry(
      { failureType: "NON_2XX_STATUS", httpStatus: 403 },
      1,
    );
    expect(plan.retry).toBe(true);
    expect(plan.userAgent).toBe(RETRY_USER_AGENT);
    expect(plan.userAgent).toBe(
      "AttorneySiteRescueBot/0.1-placeholder (retry; +https://example.com/attorney-site-rescue/crawler-info-placeholder; crawler-placeholder@example.com)",
    );
    expect(plan.delayMs).toBeGreaterThan(0);
  });

  it("refuses a second retry for both retryable classes", () => {
    for (const diagnostic of [
      { failureType: "NON_2XX_STATUS" as const, httpStatus: 403 },
      { failureType: "TIMEOUT" as const },
    ]) {
      expect(planHomeFetchRetry(diagnostic, 1).retry).toBe(true);
      expect(planHomeFetchRetry(diagnostic, 2).retry).toBe(false);
      expect(planHomeFetchRetry(diagnostic, 3).retry).toBe(false);
    }
  });

  it("offers a manual retry only for transient failures", () => {
    expect(allowsManualRetry({ failureType: "TIMEOUT" })).toBe(true);
    expect(
      allowsManualRetry({ failureType: "NON_2XX_STATUS", httpStatus: 403 }),
    ).toBe(false);
    expect(allowsManualRetry({ failureType: "SAFETY_REJECTED" })).toBe(false);
  });
});

describe("planHomeFetchRetryIfBudgetAllows", () => {
  const denied = { failureType: "NON_2XX_STATUS" as const, httpStatus: 403 };

  function nextAttemptMs(): number {
    const plan = planHomeFetchRetry(denied, 1);
    return (
      plan.delayMs +
      URL_SAFETY_BOUNDS.connectTimeoutMs +
      URL_SAFETY_BOUNDS.gotoHardTimeoutMs
    );
  }

  it("refuses a retry when the remaining first-results budget is too small", () => {
    const needed = nextAttemptMs();
    expect(
      planHomeFetchRetryIfBudgetAllows(denied, 1, needed - 1).retry,
    ).toBe(false);
  });

  it("allows the planned retry when the remaining budget covers the next attempt", () => {
    const plan = planHomeFetchRetryIfBudgetAllows(denied, 1, nextAttemptMs());
    expect(plan.retry).toBe(true);
    expect(plan.userAgent).toBe(RETRY_USER_AGENT);
  });

  it("does not plan a retry for a safety rejection even with budget left", () => {
    expect(
      planHomeFetchRetryIfBudgetAllows(
        { failureType: "SAFETY_REJECTED" },
        1,
        URL_SAFETY_BOUNDS.firstResultsBudgetMs,
      ).retry,
    ).toBe(false);
  });
});
