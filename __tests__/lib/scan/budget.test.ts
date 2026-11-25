/**
 * @jest-environment node
 */
import {
  COST_CEILING_REASON_CODE,
  SCAN_COST_CEILING_USD,
  SCAN_WALL_CLOCK_CEILING_MS,
  WALL_CLOCK_CEILING_REASON_CODE,
  createMemoryScanCostStore,
  createScanBudget,
} from "@/lib/scan/budget";

const SCAN_ID = "scan-1";

function budgetAt(nowMs: number, startedAtMs = 0) {
  return createScanBudget({
    store: createMemoryScanCostStore(),
    scanId: SCAN_ID,
    startedAtMs,
    now: () => nowMs,
  });
}

describe("whole-scan budget", () => {
  it("does not trip below the time and cost ceilings", async () => {
    const budget = createScanBudget({
      store: createMemoryScanCostStore(),
      scanId: SCAN_ID,
      startedAtMs: 0,
      now: () => SCAN_WALL_CLOCK_CEILING_MS - 1,
    });
    await budget.charge({
      category: "browserless_content",
      operationKey: "home",
      amountUsd: SCAN_COST_CEILING_USD - 0.01,
    });

    const verdict = await budget.verdict();
    expect(verdict.tripped).toBe(false);
    expect(verdict.reasonCode).toBeUndefined();
    expect(verdict.spentUsd).toBeCloseTo(0.99);
    expect(verdict.elapsedMs).toBe(SCAN_WALL_CLOCK_CEILING_MS - 1);
  });

  it("trips the wall-clock ceiling before any spend", async () => {
    const budget = budgetAt(SCAN_WALL_CLOCK_CEILING_MS);
    const verdict = await budget.verdict();

    expect(verdict).toMatchObject({
      tripped: true,
      reasonCode: WALL_CLOCK_CEILING_REASON_CODE,
      spentUsd: 0,
      elapsedMs: SCAN_WALL_CLOCK_CEILING_MS,
    });
  });

  it("trips the cost ceiling at one dollar", async () => {
    const budget = budgetAt(1_000);
    await budget.charge({
      category: "browserless_content",
      operationKey: "home",
      amountUsd: 0.6,
    });
    await budget.charge({
      category: "browserless_screenshot",
      operationKey: "shot",
      amountUsd: 0.4,
    });

    const verdict = await budget.verdict();
    expect(verdict).toMatchObject({
      tripped: true,
      reasonCode: COST_CEILING_REASON_CODE,
      spentUsd: 1,
    });
  });

  it("checks the wall clock before the cost ceiling", async () => {
    const budget = createScanBudget({
      store: createMemoryScanCostStore(),
      scanId: SCAN_ID,
      startedAtMs: 0,
      now: () => SCAN_WALL_CLOCK_CEILING_MS,
    });
    await budget.charge({
      category: "browserless_content",
      operationKey: "home",
      amountUsd: SCAN_COST_CEILING_USD,
    });

    const verdict = await budget.verdict();
    expect(verdict.reasonCode).toBe(WALL_CLOCK_CEILING_REASON_CODE);
  });

  it("charges the same operation key only once", async () => {
    const budget = budgetAt(1_000);
    await budget.charge({
      category: "browserless_content",
      operationKey: "home",
      amountUsd: 0.4,
    });
    await budget.charge({
      category: "browserless_content",
      operationKey: "home",
      amountUsd: 0.4,
    });

    expect(budget.spentUsd()).toBeCloseTo(0.4);
    expect((await budget.verdict()).tripped).toBe(false);
  });
});
