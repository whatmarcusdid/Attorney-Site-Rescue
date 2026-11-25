/**
 * Whole-scan cost and wall-clock backstops.
 *
 * Two independent ceilings, each able to stop a scan on its own:
 *
 *   - $1.00 cumulative cost across paid operations.
 *   - 15 minutes of wall clock from the scan start.
 *
 * These do not replace the 15-second first-results budget. Callers check
 * `verdict()` before spending. A charge is idempotent on `operationKey`.
 * Category names for later operations are constants only; this module does
 * not run those operations.
 */

export const SCAN_COST_CEILING_USD = 1.0;
export const SCAN_WALL_CLOCK_CEILING_MS = 15 * 60 * 1000;

export const COST_CEILING_REASON_CODE = "COST_CEILING_EXCEEDED";
export const WALL_CLOCK_CEILING_REASON_CODE = "WALL_CLOCK_CEILING_EXCEEDED";

export const COST_CATEGORIES = [
  "browserless_content",
  "browserless_screenshot",
  "browserless_performance",
  "ai_narration",
  "storage_upload",
  "email_send",
] as const;

export type CostCategory = (typeof COST_CATEGORIES)[number];

export type PricingSource = "provider_metadata" | "configured_estimate";

/**
 * Conservative per-unit estimates in USD, used when a provider does not
 * report what a call actually cost. Estimates are rounded up so the ceiling
 * fails closed.
 */
export const CONFIGURED_UNIT_COSTS_USD: Record<CostCategory, number> = {
  browserless_content: 0.01,
  browserless_screenshot: 0.01,
  browserless_performance: 0.05,
  ai_narration: 0.02,
  storage_upload: 0.001,
  email_send: 0.001,
};

export interface CostCharge {
  category: CostCategory;
  /**
   * Idempotency key for this charge, unique within the scan. Charging the
   * same key twice does not increase the total.
   */
  operationKey: string;
  quantity?: number;
  /** Actual cost, when the provider reported it. Overrides the estimate. */
  amountUsd?: number;
}

export interface KillSwitchVerdict {
  tripped: boolean;
  reasonCode?: string;
  spentUsd: number;
  elapsedMs: number;
}

export interface ScanCostChargeRecord {
  operationKey: string;
  category: CostCategory;
  quantity: number;
  amountUsd: number;
  pricingSource: PricingSource;
}

export interface ScanCostStore {
  getCostTotal(scanId: string): Promise<number>;
  /**
   * Records a charge and returns the scan total. A repeated operationKey
   * returns the current total without adding the amount again.
   */
  charge(scanId: string, entry: ScanCostChargeRecord): Promise<number>;
}

export function createMemoryScanCostStore(): ScanCostStore {
  const byScan = new Map<string, Map<string, number>>();

  function totalOf(scanId: string): number {
    const rows = byScan.get(scanId);
    if (!rows) return 0;
    let total = 0;
    for (const amount of rows.values()) total += amount;
    return total;
  }

  return {
    async getCostTotal(scanId) {
      return totalOf(scanId);
    },
    async charge(scanId, entry) {
      let rows = byScan.get(scanId);
      if (!rows) {
        rows = new Map();
        byScan.set(scanId, rows);
      }
      if (!rows.has(entry.operationKey)) {
        rows.set(entry.operationKey, entry.amountUsd);
      }
      return totalOf(scanId);
    },
  };
}

export interface ScanBudget {
  charge(charge: CostCharge): Promise<void>;
  /** Checked before every paid operation. Time is evaluated before cost. */
  verdict(): Promise<KillSwitchVerdict>;
  /** Cost ceiling only. Ignores the wall clock. */
  costVerdict(): Promise<KillSwitchVerdict>;
  spentUsd(): number;
  elapsedMs(): number;
}

export interface CreateScanBudgetInput {
  store: ScanCostStore;
  scanId: string;
  startedAtMs?: number;
  costCeilingUsd?: number;
  wallClockCeilingMs?: number;
  now?: () => number;
}

export const AI_NARRATION_RATE_USD_PER_MTOK = { input: 1.0, output: 5.0 };

export interface AiTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export function aiNarrationCostUsd(usage: AiTokenUsage): number {
  const input = (usage.inputTokens ?? 0) / 1_000_000;
  const output = (usage.outputTokens ?? 0) / 1_000_000;
  return (
    input * AI_NARRATION_RATE_USD_PER_MTOK.input +
    output * AI_NARRATION_RATE_USD_PER_MTOK.output
  );
}

export function amountForCharge(charge: CostCharge): {
  amountUsd: number;
  pricingSource: PricingSource;
} {
  if (charge.amountUsd != null) {
    return { amountUsd: charge.amountUsd, pricingSource: "provider_metadata" };
  }
  const quantity = charge.quantity ?? 1;
  return {
    amountUsd: CONFIGURED_UNIT_COSTS_USD[charge.category] * quantity,
    pricingSource: "configured_estimate",
  };
}

export function createScanBudget(input: CreateScanBudgetInput): ScanBudget {
  const now = input.now ?? Date.now;
  const costCeiling = input.costCeilingUsd ?? SCAN_COST_CEILING_USD;
  const timeCeiling = input.wallClockCeilingMs ?? SCAN_WALL_CLOCK_CEILING_MS;
  const startedAtMs = input.startedAtMs ?? now();

  let spent = 0;
  let loaded = false;

  async function load(): Promise<void> {
    if (loaded) return;
    spent = await input.store.getCostTotal(input.scanId);
    loaded = true;
  }

  const elapsedMs = () => Math.max(0, now() - startedAtMs);

  return {
    async charge(charge) {
      await load();
      const { amountUsd, pricingSource } = amountForCharge(charge);
      spent = await input.store.charge(input.scanId, {
        operationKey: charge.operationKey,
        category: charge.category,
        quantity: charge.quantity ?? 1,
        amountUsd,
        pricingSource,
      });
    },

    async verdict() {
      await load();
      const elapsed = elapsedMs();
      if (elapsed >= timeCeiling) {
        return {
          tripped: true,
          reasonCode: WALL_CLOCK_CEILING_REASON_CODE,
          spentUsd: spent,
          elapsedMs: elapsed,
        };
      }
      if (spent >= costCeiling) {
        return {
          tripped: true,
          reasonCode: COST_CEILING_REASON_CODE,
          spentUsd: spent,
          elapsedMs: elapsed,
        };
      }
      return { tripped: false, spentUsd: spent, elapsedMs: elapsed };
    },

    async costVerdict() {
      await load();
      return {
        tripped: spent >= costCeiling,
        ...(spent >= costCeiling
          ? { reasonCode: COST_CEILING_REASON_CODE }
          : {}),
        spentUsd: spent,
        elapsedMs: elapsedMs(),
      };
    },

    spentUsd: () => spent,
    elapsedMs,
  };
}
