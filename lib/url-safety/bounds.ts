/**
 * First-results limits for the home-page sync path.
 *
 * Source: Public audit A1, section "A1 results (Nov 25, 2026)"
 * https://app.notion.com/p/4217eae312ee81b6904cc6dd84852057
 *
 * The synchronous path is the home page only. page.goto waits until
 * domcontentloaded and aborts at gotoHardTimeoutMs. gotoTargetMs is the
 * page-load goal from that spike; it does not abort a load that is still
 * inside the hard limit. Axe runs inline only after HTTP 200 and only when
 * at least axeMinRemainingMs of firstResultsBudgetMs remain.
 */
export interface UrlSafetyBounds {
  allowedPorts: readonly number[];
  maxRedirects: number;
  maxResponseBytes: number;
  connectTimeoutMs: number;
  gotoTargetMs: number;
  gotoHardTimeoutMs: number;
  axeTimeoutMs: number;
  axeMinRemainingMs: number;
  firstResultsBudgetMs: number;
  /**
   * Browserless session lifetime (first-results budget plus a short close
   * buffer). This is not a second page-load budget.
   */
  sessionTimeoutMs: number;
}

export const URL_SAFETY_BOUNDS: UrlSafetyBounds = {
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
};
