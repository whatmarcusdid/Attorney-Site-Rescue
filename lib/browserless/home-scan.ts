import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import type { Browser } from "puppeteer-core";
import * as puppeteerModule from "puppeteer-core";
import { CRAWLER_USER_AGENT } from "../crawler/identity";
import {
  assessUrlSafety,
  type LookupAddresses,
  type ProbeRedirects,
  type UrlSafetyReasonCode,
} from "../url-safety";
import { URL_SAFETY_BOUNDS } from "../url-safety/bounds";
import {
  customerMessageForPartial,
  partialReasonForHttpStatus,
  redactProviderSecrets,
  type HomeScanPartialReason,
} from "./reasons";

/**
 * Home-page Browserless client for first results.
 *
 * One puppeteer-core WebSocket session: connect, goto the home page, optional
 * inline axe, then close. After goto, the final URL is checked again before
 * HTML or axe. HTML and axe are raced against the time left in
 * firstResultsBudgetMs. The Browserless session timeout stays the provider
 * kill switch. Limits live on URL_SAFETY_BOUNDS and come from
 * Public audit A1:
 * https://app.notion.com/p/4217eae312ee81b6904cc6dd84852057
 *
 * Category pages, screenshots, and Lighthouse are not part of this call.
 */

export const DEFAULT_BROWSERLESS_HOST = "production-sfo.browserless.io";

const CONFIG_DETAIL = "The scan service is not configured.";
const HOST_DETAIL = "The scan service host is not valid.";

export interface AxeScanSummary {
  status: "ran" | "skipped";
  skipReason?: "insufficient_budget" | "timeout" | "evaluate_failed";
  violationCount?: number;
}

export type HomeScanStage =
  | "url_safety"
  | "config"
  | "connect"
  | "goto"
  | "html"
  | "axe"
  | "session";

export type HomeScanResult =
  | {
      outcome: "complete";
      httpStatus: 200;
      finalUrl: string;
      html: string;
      axe: AxeScanSummary;
      elapsedMs: number;
    }
  | {
      outcome: "partial";
      reason: HomeScanPartialReason;
      stage: Exclude<HomeScanStage, "config">;
      httpStatus?: number;
      finalUrl?: string;
      html?: string;
      detail?: string;
      customerMessage: string;
      elapsedMs: number;
    }
  | {
      outcome: "rejected";
      reason: UrlSafetyReasonCode;
      stage: "url_safety";
      customerMessage: string;
    }
  | {
      outcome: "config_failure";
      reason: "MISSING_BROWSERLESS_CONFIG" | "INVALID_BROWSERLESS_HOST";
      stage: "config";
      detail: string;
    };

export interface ScanHomePageOptions {
  now?: () => number;
  lookup?: LookupAddresses;
  probe?: ProbeRedirects;
}

type ConnectFn = (options: { browserWSEndpoint: string }) => Promise<Browser>;

function resolveConnect(): ConnectFn {
  const imported = puppeteerModule as unknown as {
    connect?: ConnectFn;
    default?: { connect?: ConnectFn };
  };
  const connect = imported.connect ?? imported.default?.connect;
  if (!connect) {
    throw new Error("Browserless client is unavailable");
  }
  return connect;
}

export function browserlessHostFromEnv(raw: string | undefined): string | null {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return DEFAULT_BROWSERLESS_HOST;
  if (
    trimmed.includes("://") ||
    trimmed.includes("/") ||
    trimmed.includes("?") ||
    trimmed.includes("#") ||
    trimmed.includes("@") ||
    /\s/.test(trimmed) ||
    /token=/i.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

function websocketEndpoint(host: string, apiKey: string): string {
  const token = encodeURIComponent(apiKey);
  return `wss://${host}?token=${token}&timeout=${URL_SAFETY_BOUNDS.sessionTimeoutMs}`;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isDestroyedContext(error: unknown): boolean {
  const message = errorText(error).toLowerCase();
  return (
    message.includes("execution context was destroyed") ||
    message.includes("context was destroyed") ||
    message.includes("cannot find context with specified id")
  );
}

function isTimeoutError(error: unknown): boolean {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "ConnectTimeoutError")) {
    return true;
  }
  return /timed out|timeout/i.test(errorText(error));
}

function isSessionFailure(error: unknown): boolean {
  const message = errorText(error).toLowerCase();
  return (
    (message.includes("session") &&
      (message.includes("timeout") ||
        message.includes("timed out") ||
        message.includes("closed"))) ||
    message.includes("browser has disconnected") ||
    message.includes("target closed")
  );
}

function loadAxeSource(): string {
  const require = createRequire(`${process.cwd()}/package.json`);
  try {
    return readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
  } catch {
    const entry = require.resolve("axe-core") as string;
    return readFileSync(entry.replace(/axe\.js$/, "axe.min.js"), "utf8");
  }
}

function capHtml(
  html: string,
  maxBytes: number,
): { html: string; truncated: boolean } {
  const bytes = Buffer.from(html);
  if (bytes.length <= maxBytes) {
    return { html, truncated: false };
  }
  let sliced = bytes.subarray(0, maxBytes).toString("utf8");
  if (Buffer.byteLength(sliced) > maxBytes) {
    sliced = sliced.slice(0, -1);
  }
  return { html: sliced, truncated: true };
}

function partialResult(input: {
  reason: HomeScanPartialReason;
  stage: Exclude<HomeScanStage, "config">;
  httpStatus?: number;
  finalUrl?: string;
  html?: string;
  detail?: string;
  elapsedMs: number;
}): HomeScanResult {
  return {
    outcome: "partial",
    reason: input.reason,
    stage: input.stage,
    ...(input.httpStatus !== undefined ? { httpStatus: input.httpStatus } : {}),
    ...(input.finalUrl !== undefined ? { finalUrl: input.finalUrl } : {}),
    ...(input.html !== undefined ? { html: input.html } : {}),
    ...(input.detail !== undefined ? { detail: input.detail } : {}),
    customerMessage: customerMessageForPartial({
      reason: input.reason,
      httpStatus: input.httpStatus,
    }),
    elapsedMs: input.elapsedMs,
  };
}

function classifyThrown(
  error: unknown,
  stage: Exclude<HomeScanStage, "config">,
  elapsedMs: number,
): HomeScanResult {
  const detail = redactProviderSecrets(errorText(error));
  if (isDestroyedContext(error)) {
    return partialResult({
      reason: "EXECUTION_CONTEXT_DESTROYED",
      stage,
      detail,
      elapsedMs,
    });
  }
  if (isSessionFailure(error)) {
    return partialResult({
      reason: "SESSION_TIMEOUT",
      stage: "session",
      detail,
      elapsedMs,
    });
  }
  if (stage === "connect" && isTimeoutError(error)) {
    return partialResult({
      reason: "CONNECT_TIMEOUT",
      stage: "connect",
      detail,
      elapsedMs,
    });
  }
  if (stage === "goto" && isTimeoutError(error)) {
    return partialResult({
      reason: "LOAD_TIMEOUT",
      stage: "goto",
      detail,
      elapsedMs,
    });
  }
  if (isTimeoutError(error)) {
    return partialResult({
      reason: "SESSION_TIMEOUT",
      stage: "session",
      detail,
      elapsedMs,
    });
  }
  return partialResult({
    reason: "PROVIDER_ERROR",
    stage,
    detail,
    elapsedMs,
  });
}

function firstResultsBudgetError(
  stage: Exclude<HomeScanStage, "config">,
): Error & { stage: Exclude<HomeScanStage, "config"> } {
  return Object.assign(new Error("First-results budget exhausted"), {
    name: "FirstResultsBudgetError",
    stage,
  });
}

function isFirstResultsBudgetError(
  error: unknown,
): error is Error & { stage: Exclude<HomeScanStage, "config"> } {
  return error instanceof Error && error.name === "FirstResultsBudgetError";
}

async function raceFirstResultsBudget<T>(
  work: Promise<T>,
  remainingMs: number,
  stageAtStop: () => Exclude<HomeScanStage, "config">,
): Promise<T> {
  if (remainingMs <= 0) {
    throw firstResultsBudgetError(stageAtStop());
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(firstResultsBudgetError(stageAtStop()));
        }, remainingMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function connectWithTimeout(endpoint: string): Promise<Browser> {
  const connect = resolveConnect();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      connect({ browserWSEndpoint: endpoint }).then((browser) => {
        if (timedOut) {
          void browser.close().catch(() => undefined);
        }
        return browser;
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(
            Object.assign(new Error("Browserless connect timed out"), {
              name: "ConnectTimeoutError",
            }),
          );
        }, URL_SAFETY_BOUNDS.connectTimeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runAxe(
  page: Awaited<ReturnType<Browser["newPage"]>>,
): Promise<{ violations?: unknown[] }> {
  const source = loadAxeSource();
  await page.addScriptTag({ content: source });
  return page.evaluate(async (timeoutMs: number) => {
    const axeApi = (
      globalThis as typeof globalThis & {
        axe?: { run: () => Promise<{ violations?: unknown[] }> };
      }
    ).axe;
    if (!axeApi) {
      throw new Error("axe unavailable");
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        axeApi.run(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error("axe timeout"));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }, URL_SAFETY_BOUNDS.axeTimeoutMs);
}

export async function scanHomePage(
  input: string,
  options: ScanHomePageOptions = {},
): Promise<HomeScanResult> {
  const now = options.now ?? Date.now;
  const started = now();
  const elapsed = () => Math.max(0, now() - started);

  let safety;
  try {
    safety = await assessUrlSafety(input, {
      lookup: options.lookup,
      probe: options.probe,
    });
  } catch (error) {
    return partialResult({
      reason: "PROVIDER_ERROR",
      stage: "url_safety",
      detail: redactProviderSecrets(errorText(error)),
      elapsedMs: elapsed(),
    });
  }

  if (!safety.ok) {
    return {
      outcome: "rejected",
      reason: safety.reasonCode,
      stage: "url_safety",
      customerMessage: safety.customerMessage,
    };
  }

  const apiKey = process.env.BROWSERLESS_API_KEY?.trim();
  if (!apiKey) {
    return {
      outcome: "config_failure",
      reason: "MISSING_BROWSERLESS_CONFIG",
      stage: "config",
      detail: CONFIG_DETAIL,
    };
  }

  const host = browserlessHostFromEnv(process.env.BROWSERLESS_HOST);
  if (!host) {
    return {
      outcome: "config_failure",
      reason: "INVALID_BROWSERLESS_HOST",
      stage: "config",
      detail: HOST_DETAIL,
    };
  }

  const endpoint = websocketEndpoint(host, apiKey);
  let browser: Browser | undefined;
  let stage: Exclude<HomeScanStage, "config"> = "connect";

  try {
    browser = await connectWithTimeout(endpoint);
    const page = await browser.newPage();
    await page.setUserAgent(CRAWLER_USER_AGENT);

    stage = "goto";
    const response = await page.goto(safety.finalUrl, {
      waitUntil: "domcontentloaded",
      timeout: URL_SAFETY_BOUNDS.gotoHardTimeoutMs,
    });

    if (!response) {
      return partialResult({
        reason: "LOAD_FAILED",
        stage: "goto",
        elapsedMs: elapsed(),
      });
    }

    const httpStatus = response.status();
    const finalUrl = response.url();

    let redirectCount = 0;
    try {
      redirectCount = response.request().redirectChain().length;
    } catch (error) {
      if (isDestroyedContext(error)) {
        return partialResult({
          reason: "EXECUTION_CONTEXT_DESTROYED",
          stage: "goto",
          httpStatus,
          finalUrl,
          detail: redactProviderSecrets(errorText(error)),
          elapsedMs: elapsed(),
        });
      }
      throw error;
    }

    if (redirectCount > URL_SAFETY_BOUNDS.maxRedirects) {
      return partialResult({
        reason: "TOO_MANY_REDIRECTS",
        stage: "goto",
        httpStatus,
        finalUrl,
        elapsedMs: elapsed(),
      });
    }

    const remainingMs = URL_SAFETY_BOUNDS.firstResultsBudgetMs - elapsed();
    let reportedUrl = finalUrl;

    stage = "url_safety";
    if (remainingMs <= 0) {
      return partialResult({
        reason: "FIRST_RESULTS_BUDGET",
        stage: "url_safety",
        httpStatus,
        finalUrl,
        detail: redactProviderSecrets("First-results budget exhausted"),
        elapsedMs: elapsed(),
      });
    }

    try {
      return await raceFirstResultsBudget(
        (async (): Promise<HomeScanResult> => {
          stage = "url_safety";
          let pageUrl = "";
          try {
            pageUrl = page.url();
          } catch (error) {
            if (isDestroyedContext(error)) {
              return partialResult({
                reason: "EXECUTION_CONTEXT_DESTROYED",
                stage: "url_safety",
                httpStatus,
                finalUrl,
                detail: redactProviderSecrets(errorText(error)),
                elapsedMs: elapsed(),
              });
            }
            throw error;
          }

          const landedUrls = [finalUrl];
          if (pageUrl && pageUrl !== finalUrl) {
            landedUrls.push(pageUrl);
          }
          for (const candidate of landedUrls) {
            const landed = await assessUrlSafety(candidate, {
              lookup: options.lookup,
            });
            if (!landed.ok) {
              return {
                outcome: "rejected",
                reason: landed.reasonCode,
                stage: "url_safety",
                customerMessage: landed.customerMessage,
              };
            }
          }

          const landedUrl =
            pageUrl && pageUrl !== finalUrl ? pageUrl : finalUrl;
          reportedUrl = landedUrl;

          stage = "html";
          const rawHtml = await page.content();
          const capped = capHtml(rawHtml, URL_SAFETY_BOUNDS.maxResponseBytes);
          if (capped.truncated) {
            return partialResult({
              reason: "RESPONSE_TOO_LARGE",
              stage: "html",
              httpStatus,
              finalUrl: landedUrl,
              html: capped.html,
              elapsedMs: elapsed(),
            });
          }

          if (httpStatus !== 200) {
            return partialResult({
              reason: partialReasonForHttpStatus(httpStatus),
              stage: "goto",
              httpStatus,
              finalUrl: landedUrl,
              html: capped.html,
              elapsedMs: elapsed(),
            });
          }

          const leftForAxe =
            URL_SAFETY_BOUNDS.firstResultsBudgetMs - elapsed();
          if (leftForAxe < URL_SAFETY_BOUNDS.axeMinRemainingMs) {
            return {
              outcome: "complete",
              httpStatus: 200,
              finalUrl: landedUrl,
              html: capped.html,
              axe: { status: "skipped", skipReason: "insufficient_budget" },
              elapsedMs: elapsed(),
            };
          }

          stage = "axe";
          try {
            const axeResult = await runAxe(page);
            const violationCount = Array.isArray(axeResult?.violations)
              ? axeResult.violations.length
              : 0;
            return {
              outcome: "complete",
              httpStatus: 200,
              finalUrl: landedUrl,
              html: capped.html,
              axe: { status: "ran", violationCount },
              elapsedMs: elapsed(),
            };
          } catch (error) {
            if (isFirstResultsBudgetError(error)) {
              throw error;
            }
            if (isDestroyedContext(error) || isSessionFailure(error)) {
              const stopped = classifyThrown(error, "axe", elapsed());
              if (stopped.outcome === "partial") {
                return {
                  ...stopped,
                  httpStatus,
                  finalUrl: landedUrl,
                  html: capped.html,
                };
              }
              return stopped;
            }
            const skipReason = isTimeoutError(error) ? "timeout" : "evaluate_failed";
            return {
              outcome: "complete",
              httpStatus: 200,
              finalUrl: landedUrl,
              html: capped.html,
              axe: { status: "skipped", skipReason },
              elapsedMs: elapsed(),
            };
          }
        })(),
        remainingMs,
        () => stage,
      );
    } catch (error) {
      if (isFirstResultsBudgetError(error)) {
        return partialResult({
          reason: "FIRST_RESULTS_BUDGET",
          stage: error.stage,
          httpStatus,
          finalUrl: reportedUrl,
          detail: redactProviderSecrets(errorText(error)),
          elapsedMs: elapsed(),
        });
      }
      throw error;
    }
  } catch (error) {
    if (isFirstResultsBudgetError(error)) {
      return partialResult({
        reason: "FIRST_RESULTS_BUDGET",
        stage: error.stage,
        detail: redactProviderSecrets(errorText(error)),
        elapsedMs: elapsed(),
      });
    }
    return classifyThrown(error, stage, elapsed());
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
}
