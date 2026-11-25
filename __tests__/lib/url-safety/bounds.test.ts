/**
 * @jest-environment node
 */
import { URL_SAFETY_BOUNDS } from "@/lib/url-safety/bounds";

describe("URL_SAFETY_BOUNDS", () => {
  it("uses the A1 first-results limits", () => {
    expect(URL_SAFETY_BOUNDS).toEqual({
      allowedPorts: [80, 443],
      maxRedirects: 5,
      maxResponseBytes: 1_048_576,
      connectTimeoutMs: 2_000,
      gotoTargetMs: 5_000,
      gotoHardTimeoutMs: 8_000,
      axeTimeoutMs: 2_000,
      axeMinRemainingMs: 2_500,
      firstResultsBudgetMs: 15_000,
      sessionTimeoutMs: 20_000,
    });
  });

  it("does not keep the previous fetch, performance, or page-count limits", () => {
    expect("maxFetchDurationMs" in URL_SAFETY_BOUNDS).toBe(false);
    expect("maxPerformanceFetchMs" in URL_SAFETY_BOUNDS).toBe(false);
    expect("maxPagesPerDomain" in URL_SAFETY_BOUNDS).toBe(false);
  });

  it("keeps the session lifetime above the first-results budget", () => {
    expect(URL_SAFETY_BOUNDS.sessionTimeoutMs).toBeGreaterThan(
      URL_SAFETY_BOUNDS.firstResultsBudgetMs,
    );
  });
});
