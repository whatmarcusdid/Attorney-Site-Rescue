/**
 * @jest-environment node
 */
jest.mock("node:dns", () => ({
  promises: {
    lookup: jest.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
  },
}));

jest.mock("puppeteer-core", () => {
  const connect = jest.fn();
  return {
    __esModule: true,
    connect,
    default: { connect },
  };
});

import * as puppeteerModule from "puppeteer-core";
import { CRAWLER_USER_AGENT } from "@/lib/crawler/identity";
import { scanHomePage } from "@/lib/browserless/home-scan";
import { URL_SAFETY_BOUNDS } from "@/lib/url-safety/bounds";

const FAKE_KEY = "test-browserless-key";

function connectMock(): jest.Mock {
  const imported = puppeteerModule as unknown as {
    connect?: jest.Mock;
    default?: { connect?: jest.Mock };
  };
  const connect = imported.connect ?? imported.default?.connect;
  if (!connect) {
    throw new Error("missing connect mock");
  }
  return connect;
}

function redactedEndpoint(endpoint: string): string {
  return endpoint.split(FAKE_KEY).join("[redacted]");
}

function mockSession(options?: {
  status?: number;
  html?: string;
  finalUrl?: string;
  redirects?: number;
  pageUrl?: string;
  goto?: jest.Mock;
  evaluate?: jest.Mock;
  content?: jest.Mock;
}) {
  const evaluate =
    options?.evaluate ?? jest.fn().mockResolvedValue({ violations: [{ id: "a" }, { id: "b" }] });
  const addScriptTag = jest.fn().mockResolvedValue(undefined);
  const content =
    options?.content ??
    jest.fn().mockResolvedValue(options?.html ?? "<html><body>ok</body></html>");
  const setUserAgent = jest.fn().mockResolvedValue(undefined);
  const url = jest.fn(
    () => options?.pageUrl ?? options?.finalUrl ?? "https://example.com/",
  );
  const goto =
    options?.goto ??
    jest.fn().mockResolvedValue({
      status: () => options?.status ?? 200,
      url: () => options?.finalUrl ?? "https://example.com/",
      request: () => ({
        redirectChain: () => Array.from({ length: options?.redirects ?? 0 }),
      }),
    });
  const close = jest.fn().mockResolvedValue(undefined);
  const mainFrame = {};
  const requestHandlers: Array<(request: InterceptedRequest) => void> = [];
  const setRequestInterception = jest.fn().mockResolvedValue(undefined);
  const on = jest.fn((event: string, handler: (request: InterceptedRequest) => void) => {
    if (event === "request") requestHandlers.push(handler);
  });
  const page = {
    setUserAgent,
    goto,
    content,
    addScriptTag,
    evaluate,
    url,
    setRequestInterception,
    on,
    mainFrame: () => mainFrame,
  };
  const browser = {
    newPage: jest.fn().mockResolvedValue(page),
    close,
  };
  connectMock().mockResolvedValue(browser);
  return {
    browser,
    page,
    close,
    goto,
    evaluate,
    addScriptTag,
    setUserAgent,
    content,
    mainFrame,
    requestHandlers,
    setRequestInterception,
  };
}

type InterceptedRequest = {
  url: () => string;
  isNavigationRequest: () => boolean;
  frame: () => unknown;
  redirectChain: () => readonly unknown[];
  abort: jest.Mock;
  continue: jest.Mock;
};

describe("scanHomePage", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    connectMock().mockReset();
    delete process.env.BROWSERLESS_API_KEY;
    delete process.env.BROWSERLESS_HOST;
    global.fetch = jest.fn(async () => ({
      status: 200,
      headers: { get: () => null },
      body: { cancel: async () => undefined },
    })) as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  it("returns a 200 page and runs axe when budget remains", async () => {
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    const session = mockSession();

    const result = await scanHomePage("https://example.com", { now: () => 0 });

    expect(result).toMatchObject({
      outcome: "complete",
      httpStatus: 200,
      finalUrl: "https://example.com/",
      html: "<html><body>ok</body></html>",
      axe: { status: "ran", violationCount: 2 },
    });
    expect(session.setUserAgent).toHaveBeenCalledWith(CRAWLER_USER_AGENT);
    expect(session.goto).toHaveBeenCalledWith("https://example.com/", {
      waitUntil: "domcontentloaded",
      timeout: URL_SAFETY_BOUNDS.gotoHardTimeoutMs,
    });
    expect(session.addScriptTag).toHaveBeenCalled();
    expect(session.evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      URL_SAFETY_BOUNDS.axeTimeoutMs,
    );
    expect(session.close).toHaveBeenCalled();

    const endpoint = connectMock().mock.calls[0][0].browserWSEndpoint as string;
    expect(redactedEndpoint(endpoint)).toBe(
      "wss://production-sfo.browserless.io?token=[redacted]&timeout=20000",
    );
    expect(JSON.stringify(result)).not.toContain(FAKE_KEY);
  });

  it("skips axe when fewer than 2500 ms of the budget remain", async () => {
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    const session = mockSession();
    let calls = 0;
    const now = () => {
      calls += 1;
      return calls === 1 ? 0 : 12_501;
    };

    const result = await scanHomePage("https://example.com", { now });

    expect(result).toMatchObject({
      outcome: "complete",
      httpStatus: 200,
      html: "<html><body>ok</body></html>",
      axe: { status: "skipped", skipReason: "insufficient_budget" },
    });
    expect(session.addScriptTag).not.toHaveBeenCalled();
    expect(session.evaluate).not.toHaveBeenCalled();
  });

  it("returns partial when page.content hangs past the first-results budget", async () => {
    jest.useFakeTimers();
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    const session = mockSession({
      content: jest.fn(() => new Promise(() => undefined)),
    });

    const pending = scanHomePage("https://example.com");
    await jest.advanceTimersByTimeAsync(URL_SAFETY_BOUNDS.firstResultsBudgetMs);
    const result = await pending;

    expect(result).toMatchObject({
      outcome: "partial",
      reason: "FIRST_RESULTS_BUDGET",
      stage: "html",
    });
    expect(result.outcome).not.toBe("complete");
    expect(session.close).toHaveBeenCalled();
    expect(session.addScriptTag).not.toHaveBeenCalled();
    expect(session.evaluate).not.toHaveBeenCalled();
  });

  it("does not complete when goto lands on a blocked address", async () => {
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    const session = mockSession({ finalUrl: "http://127.0.0.1/" });

    const result = await scanHomePage("https://example.com");

    expect(result.outcome).not.toBe("complete");
    expect(result).toMatchObject({
      outcome: "rejected",
      reason: "BLOCKED_ADDRESS",
      stage: "url_safety",
    });
    expect(session.content).not.toHaveBeenCalled();
    expect(session.addScriptTag).not.toHaveBeenCalled();
    expect(session.evaluate).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalled();
  });

  it.each([
    [202, "HTTP_202"],
    [403, "HTTP_403"],
    [503, "HTTP_5XX"],
  ] as const)("returns partial for HTTP %s and does not run axe", async (status, reason) => {
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    const session = mockSession({ status });

    const result = await scanHomePage("https://example.com");

    expect(result).toMatchObject({
      outcome: "partial",
      reason,
      stage: "goto",
      httpStatus: status,
    });
    expect(result).not.toMatchObject({ outcome: "complete" });
    expect(session.addScriptTag).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalled();
  });

  it("returns partial when connect exceeds the 2000 ms limit", async () => {
    jest.useFakeTimers();
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    const lateClose = jest.fn().mockResolvedValue(undefined);
    connectMock().mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              newPage: jest.fn(),
              close: lateClose,
            });
          }, URL_SAFETY_BOUNDS.connectTimeoutMs + 1_000);
        }),
    );

    const pending = scanHomePage("https://example.com");
    await jest.advanceTimersByTimeAsync(URL_SAFETY_BOUNDS.connectTimeoutMs);
    const result = await pending;

    expect(result).toMatchObject({
      outcome: "partial",
      reason: "CONNECT_TIMEOUT",
      stage: "connect",
    });
    expect(lateClose).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1_000);
    expect(lateClose).toHaveBeenCalled();
  });

  it("returns FIRST_RESULTS_BUDGET and never calls goto with a non-positive timeout", async () => {
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    let clock = 0;
    const session = mockSession({
      goto: jest.fn(async (_url: string, options?: { timeout?: number }) => {
        const timeout = options?.timeout ?? 0;
        const waitMs = timeout > 0 ? timeout : 30_000;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        return {
          status: () => 200,
          url: () => "https://example.com/",
          request: () => ({ redirectChain: () => [] }),
        };
      }),
    });
    session.setUserAgent.mockImplementation(async () => {
      clock = URL_SAFETY_BOUNDS.firstResultsBudgetMs;
    });

    const result = await scanHomePage("https://example.com", {
      now: () => clock,
    });

    expect(result).toMatchObject({
      outcome: "partial",
      reason: "FIRST_RESULTS_BUDGET",
      stage: "goto",
    });
    if (result.outcome === "partial") {
      expect(result.elapsedMs).toBeLessThanOrEqual(
        URL_SAFETY_BOUNDS.firstResultsBudgetMs,
      );
    }
    expect(session.goto).not.toHaveBeenCalled();
    for (const call of session.goto.mock.calls) {
      const timeout = (call[1] as { timeout?: number } | undefined)?.timeout;
      expect(timeout).toBeGreaterThan(0);
    }
    expect(session.close).toHaveBeenCalled();
  });

  it("cuts off a slow connect at the time left and closes it if it resolves late", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    const lateClose = jest.fn().mockResolvedValue(undefined);
    connectMock().mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              newPage: jest.fn(),
              close: lateClose,
            });
          }, 30_000);
        }),
    );

    const pending = scanHomePage("https://example.com", {
      now: () => Date.now(),
      lookup: async () => ["93.184.216.34"],
      probe: async () => {
        jest.setSystemTime(URL_SAFETY_BOUNDS.firstResultsBudgetMs - 400);
        return { status: 200 };
      },
    });
    await jest.advanceTimersByTimeAsync(400);
    const result = await pending;

    expect(result).toMatchObject({
      outcome: "partial",
      reason: "FIRST_RESULTS_BUDGET",
      stage: "connect",
    });
    if (result.outcome === "partial") {
      expect(result.elapsedMs).toBeLessThanOrEqual(
        URL_SAFETY_BOUNDS.firstResultsBudgetMs,
      );
    }
    expect(Date.now()).toBeLessThanOrEqual(URL_SAFETY_BOUNDS.firstResultsBudgetMs);
    expect(lateClose).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(30_000);
    expect(lateClose).toHaveBeenCalled();
  });

  it("cuts off a slow newPage at the time left and closes a late page", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    const pageClose = jest.fn().mockResolvedValue(undefined);
    const browserClose = jest.fn().mockResolvedValue(undefined);
    connectMock().mockResolvedValue({
      newPage: () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              close: pageClose,
              setUserAgent: jest.fn().mockResolvedValue(undefined),
              goto: jest.fn(),
              setRequestInterception: jest.fn().mockResolvedValue(undefined),
              on: jest.fn(),
              mainFrame: () => ({}),
            });
          }, 30_000);
        }),
      close: browserClose,
    });

    const pending = scanHomePage("https://example.com", {
      now: () => Date.now(),
      lookup: async () => ["93.184.216.34"],
      probe: async () => {
        jest.setSystemTime(URL_SAFETY_BOUNDS.firstResultsBudgetMs - 400);
        return { status: 200 };
      },
    });
    await jest.advanceTimersByTimeAsync(400);
    const result = await pending;

    expect(result).toMatchObject({
      outcome: "partial",
      reason: "FIRST_RESULTS_BUDGET",
      stage: "connect",
    });
    if (result.outcome === "partial") {
      expect(result.elapsedMs).toBeLessThanOrEqual(
        URL_SAFETY_BOUNDS.firstResultsBudgetMs,
      );
    }
    expect(Date.now()).toBeLessThanOrEqual(URL_SAFETY_BOUNDS.firstResultsBudgetMs);
    expect(browserClose).toHaveBeenCalled();
    expect(pageClose).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(30_000);
    expect(pageClose).toHaveBeenCalled();
  });

  it("gives goto a positive timeout no greater than one second when that is all that is left", async () => {
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    let clock = 0;
    const session = mockSession();
    session.setUserAgent.mockImplementation(async () => {
      clock = URL_SAFETY_BOUNDS.firstResultsBudgetMs - 1_000;
    });

    await scanHomePage("https://example.com", { now: () => clock });

    const timeout = (
      session.goto.mock.calls[0]?.[1] as { timeout?: number } | undefined
    )?.timeout;
    expect(timeout).toBeGreaterThan(0);
    expect(timeout).toBeLessThanOrEqual(1_000);
  });

  it("returns FIRST_RESULTS_BUDGET when setUserAgent hangs past the deadline", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    const session = mockSession();
    session.setUserAgent.mockImplementation(() => new Promise(() => undefined));

    const pending = scanHomePage("https://example.com", {
      now: () => Date.now(),
    });
    await jest.advanceTimersByTimeAsync(URL_SAFETY_BOUNDS.firstResultsBudgetMs);
    const result = await pending;

    expect(result).toMatchObject({
      outcome: "partial",
      reason: "FIRST_RESULTS_BUDGET",
    });
    if (result.outcome === "partial") {
      expect(result.elapsedMs).toBeLessThanOrEqual(
        URL_SAFETY_BOUNDS.firstResultsBudgetMs,
      );
    }
    expect(Date.now()).toBeLessThanOrEqual(URL_SAFETY_BOUNDS.firstResultsBudgetMs);
    expect(session.close).toHaveBeenCalled();
  });

  it("returns FIRST_RESULTS_BUDGET when request interception setup hangs past the deadline", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    const session = mockSession();
    session.setRequestInterception.mockImplementation(
      () => new Promise(() => undefined),
    );

    const pending = scanHomePage("https://example.com", {
      now: () => Date.now(),
    });
    await jest.advanceTimersByTimeAsync(URL_SAFETY_BOUNDS.firstResultsBudgetMs);
    const result = await pending;

    expect(result).toMatchObject({
      outcome: "partial",
      reason: "FIRST_RESULTS_BUDGET",
    });
    if (result.outcome === "partial") {
      expect(result.elapsedMs).toBeLessThanOrEqual(
        URL_SAFETY_BOUNDS.firstResultsBudgetMs,
      );
    }
    expect(Date.now()).toBeLessThanOrEqual(URL_SAFETY_BOUNDS.firstResultsBudgetMs);
    expect(session.close).toHaveBeenCalled();
  });

  it("returns partial for HTTP 404 and does not run axe", async () => {
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    const session = mockSession({ status: 404 });

    const result = await scanHomePage("https://example.com");

    expect(result).toMatchObject({
      outcome: "partial",
      reason: "HTTP_NON_200",
      httpStatus: 404,
    });
    expect(result.outcome).not.toBe("complete");
    expect(session.addScriptTag).not.toHaveBeenCalled();
    expect(session.evaluate).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalled();
  });

  it("rejects when the page URL moves to a blocked address after load", async () => {
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    const session = mockSession({
      finalUrl: "https://example.com/",
      pageUrl: "http://127.0.0.1/",
    });

    const result = await scanHomePage("https://example.com");

    expect(result.outcome).not.toBe("complete");
    expect(result).toMatchObject({
      outcome: "rejected",
      reason: "BLOCKED_ADDRESS",
      stage: "url_safety",
    });
    expect(session.content).not.toHaveBeenCalled();
    expect(session.addScriptTag).not.toHaveBeenCalled();
    expect(session.evaluate).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalled();
  });

  it("reports the page URL when the page moves to another safe address", async () => {
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    mockSession({
      finalUrl: "https://example.com/",
      pageUrl: "https://example.com/home",
    });

    const result = await scanHomePage("https://example.com");

    expect(result).toMatchObject({
      outcome: "complete",
      httpStatus: 200,
      finalUrl: "https://example.com/home",
    });
  });

  it("returns SITE_TIMEOUT when the post-goto lookup hangs past the connect bound", async () => {
    jest.useFakeTimers();
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    const session = mockSession();
    let lookups = 0;
    const lookup = () => {
      lookups += 1;
      if (lookups === 1) return Promise.resolve(["93.184.216.34"]);
      return new Promise<string[]>(() => undefined);
    };

    const pending = scanHomePage("https://example.com", { lookup });
    await jest.advanceTimersByTimeAsync(URL_SAFETY_BOUNDS.connectTimeoutMs);
    const result = await pending;

    expect(result).toMatchObject({
      outcome: "rejected",
      reason: "SITE_TIMEOUT",
      stage: "url_safety",
      customerMessage: "This website took too long to respond.",
    });
    expect(result.outcome).not.toBe("complete");
    expect(session.close).toHaveBeenCalled();
    expect(session.addScriptTag).not.toHaveBeenCalled();
    expect(session.content).not.toHaveBeenCalled();
  });

  it("does not probe a loaded page and still rejects a private landed address", async () => {
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    const session = mockSession({
      finalUrl: "https://example.com/",
      pageUrl: "https://internal.example/",
    });
    const probed: string[] = [];
    const probe = jest.fn(async (url: string) => {
      probed.push(url);
      return { status: 200 };
    });

    const result = await scanHomePage("https://example.com", {
      now: () => 0,
      probe,
      lookup: async (hostname) => {
        if (hostname === "internal.example") return ["10.0.0.5"];
        return ["93.184.216.34"];
      },
    });

    expect(probed).toEqual(["https://example.com/"]);
    expect(result).toMatchObject({
      outcome: "rejected",
      reason: "BLOCKED_ADDRESS",
      stage: "url_safety",
    });
    expect(session.content).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalled();
  });

  it("does not reject a loaded page when a later probe would hang", async () => {
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    mockSession();
    let calls = 0;
    const probe = jest.fn(() => {
      calls += 1;
      if (calls > 1) return new Promise<never>(() => undefined);
      return Promise.resolve({ status: 200 });
    });

    const result = await scanHomePage("https://example.com", {
      now: () => 0,
      probe,
      lookup: async () => ["93.184.216.34"],
    });

    expect(calls).toBe(1);
    expect(result).toMatchObject({
      outcome: "complete",
      httpStatus: 200,
      finalUrl: "https://example.com/",
    });
  });

  it("ends by the first-results deadline when hops and the page load are slow", async () => {
    jest.useFakeTimers();
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    let clock = 0;
    const now = () => clock;
    const hopMs = 1900;
    let hops = 0;
    let gotoTimeout = -1;
    const session = mockSession({
      goto: jest.fn((_url: string, opts?: { timeout?: number }) => {
        gotoTimeout = opts?.timeout ?? -1;
        const timeLeftAtGoto =
          URL_SAFETY_BOUNDS.firstResultsBudgetMs - hopMs * 4;
        const pageLoadMs =
          Math.min(URL_SAFETY_BOUNDS.gotoHardTimeoutMs, timeLeftAtGoto) - 1;
        return new Promise((resolve) => {
          setTimeout(() => {
            clock += pageLoadMs;
            resolve({
              status: () => 200,
              url: () => "https://example.com/",
              request: () => ({ redirectChain: () => [] }),
            });
          }, pageLoadMs);
        });
      }),
    });
    const probe = () =>
      new Promise<{ status: number; location?: string }>((resolve) => {
        setTimeout(() => {
          clock += hopMs;
          hops += 1;
          if (hops < 4) {
            resolve({
              status: 302,
              location: `https://example.com/hop${hops}`,
            });
          } else {
            resolve({ status: 200 });
          }
        }, hopMs);
      });

    const pending = scanHomePage("https://example.com", {
      now,
      probe,
      lookup: async () => ["93.184.216.34"],
    });
    await jest.advanceTimersByTimeAsync(URL_SAFETY_BOUNDS.firstResultsBudgetMs);
    const result = await pending;

    const timeLeftAtGoto = URL_SAFETY_BOUNDS.firstResultsBudgetMs - hopMs * 4;
    expect(gotoTimeout).toBe(
      Math.min(URL_SAFETY_BOUNDS.gotoHardTimeoutMs, timeLeftAtGoto),
    );
    expect(clock).toBeLessThanOrEqual(URL_SAFETY_BOUNDS.firstResultsBudgetMs);
    expect(clock).toBeGreaterThan(
      URL_SAFETY_BOUNDS.firstResultsBudgetMs -
        URL_SAFETY_BOUNDS.axeMinRemainingMs,
    );
    expect(result).toMatchObject({
      outcome: "complete",
      axe: { status: "skipped", skipReason: "insufficient_budget" },
    });
    expect(session.addScriptTag).not.toHaveBeenCalled();
    expect(session.evaluate).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalled();
  });

  it("returns rejected when the post-goto lookup throws", async () => {
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    const session = mockSession({
      finalUrl: "https://cdn.example/",
      pageUrl: "https://cdn.example/",
    });

    const result = await scanHomePage("https://example.com", {
      lookup: async (hostname) => {
        if (hostname === "cdn.example") {
          throw new Error("ENOTFOUND");
        }
        return ["93.184.216.34"];
      },
    });

    expect(result).toMatchObject({
      outcome: "rejected",
      reason: "DNS_FAILED",
      stage: "url_safety",
    });
    expect(session.content).not.toHaveBeenCalled();
    expect(session.addScriptTag).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalled();
  });

  it("opens one Browserless session for a 403", async () => {
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    mockSession({ status: 403 });

    await scanHomePage("https://example.com");

    expect(connectMock()).toHaveBeenCalledTimes(1);
  });

  it("opens one Browserless session for a load timeout", async () => {
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    mockSession({
      goto: jest.fn().mockRejectedValue(
        Object.assign(new Error("Navigation timeout of 8000 ms exceeded"), {
          name: "TimeoutError",
        }),
      ),
    });

    const result = await scanHomePage("https://example.com");

    expect(result).toMatchObject({
      outcome: "partial",
      reason: "LOAD_TIMEOUT",
      stage: "goto",
    });
    expect(connectMock()).toHaveBeenCalledTimes(1);
  });

  it("keeps a 200 page when axe itself times out", async () => {
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    mockSession({
      evaluate: jest.fn().mockRejectedValue(new Error("axe timeout")),
    });

    const result = await scanHomePage("https://example.com", { now: () => 0 });

    expect(result).toMatchObject({
      outcome: "complete",
      httpStatus: 200,
      html: "<html><body>ok</body></html>",
      axe: { status: "skipped", skipReason: "timeout" },
    });
  });

  it("returns partial when page load hits the hard timeout", async () => {
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    mockSession({
      goto: jest.fn().mockRejectedValue(
        Object.assign(new Error("Navigation timeout of 8000 ms exceeded"), {
          name: "TimeoutError",
        }),
      ),
    });

    const result = await scanHomePage("https://example.com");

    expect(result).toMatchObject({
      outcome: "partial",
      reason: "LOAD_TIMEOUT",
      stage: "goto",
    });
    expect(result.outcome).not.toBe("complete");
  });

  it("returns partial when the session times out", async () => {
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    mockSession({
      goto: jest.fn().mockRejectedValue(
        new Error("Session closed. The session timed out."),
      ),
    });

    const result = await scanHomePage("https://example.com");

    expect(result).toMatchObject({
      outcome: "partial",
      reason: "SESSION_TIMEOUT",
      stage: "session",
    });
  });

  it("returns partial when navigation destroys the execution context", async () => {
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    const session = mockSession({
      evaluate: jest
        .fn()
        .mockRejectedValue(
          new Error(
            "Execution context was destroyed, most likely because of a navigation.",
          ),
        ),
    });

    const result = await scanHomePage("https://example.com", { now: () => 0 });

    expect(result).toMatchObject({
      outcome: "partial",
      reason: "EXECUTION_CONTEXT_DESTROYED",
      stage: "axe",
      httpStatus: 200,
    });
    expect(result.outcome).not.toBe("complete");
    expect(session.close).toHaveBeenCalled();
    if (result.outcome === "partial") {
      expect(result.detail ?? "").not.toContain(FAKE_KEY);
    }
  });

  it("returns partial when HTML exceeds 1 MiB", async () => {
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    const session = mockSession({
      html: "a".repeat(URL_SAFETY_BOUNDS.maxResponseBytes + 1),
    });

    const result = await scanHomePage("https://example.com", { now: () => 0 });

    expect(result).toMatchObject({
      outcome: "partial",
      reason: "RESPONSE_TOO_LARGE",
      stage: "html",
      httpStatus: 200,
    });
    if (result.outcome === "partial") {
      expect(Buffer.byteLength(result.html ?? "")).toBeLessThanOrEqual(
        URL_SAFETY_BOUNDS.maxResponseBytes,
      );
    }
    expect(session.addScriptTag).not.toHaveBeenCalled();
  });

  it("returns partial when the browser follows more than 5 redirects", async () => {
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    const session = mockSession({ redirects: 6 });

    const result = await scanHomePage("https://example.com");

    expect(result).toMatchObject({
      outcome: "partial",
      reason: "TOO_MANY_REDIRECTS",
      stage: "goto",
    });
    expect(session.content).not.toHaveBeenCalled();
    expect(session.addScriptTag).not.toHaveBeenCalled();
  });

  it("returns a config failure when the key is missing and does not throw", async () => {
    const result = await scanHomePage("https://example.com");

    expect(result).toEqual({
      outcome: "config_failure",
      reason: "MISSING_BROWSERLESS_CONFIG",
      stage: "config",
      detail: "The scan service is not configured.",
    });
    expect(JSON.stringify(result)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(result)).not.toMatch(/token=/i);

    process.env.BROWSERLESS_API_KEY = "   ";
    const blank = await scanHomePage("https://example.com");
    expect(blank).toMatchObject({
      outcome: "config_failure",
      reason: "MISSING_BROWSERLESS_CONFIG",
    });
    expect(connectMock()).not.toHaveBeenCalled();
  });

  it("redacts a fake key from a provider error", async () => {
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    connectMock().mockRejectedValue(
      new Error(
        `connect failed wss://production-sfo.browserless.io?token=${FAKE_KEY}&timeout=20000`,
      ),
    );

    const result = await scanHomePage("https://example.com");

    expect(result.outcome).toBe("partial");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(FAKE_KEY);
    expect(serialized).toContain("[redacted]");
  });

  it("does not call Browserless when URL safety rejects", async () => {
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    const blocked = [
      "https://user:pass@example.com/secret",
      "ftp://example.com",
      "https://example.com:8080",
      "http://localhost",
      "http://127.0.0.1",
      "http://10.1.2.3",
      "http://192.168.1.4",
      "http://169.254.169.254",
      "https://luckycasino.net",
    ];

    for (const url of blocked) {
      const result = await scanHomePage(url);
      expect(result.outcome).toBe("rejected");
      expect(result).not.toMatchObject({ httpStatus: 200, outcome: "complete" });
    }

    const redirected = await scanHomePage("https://example.com", {
      lookup: async () => ["93.184.216.34"],
      probe: async () => ({ status: 302, location: "https://example.com/next" }),
    });
    expect(redirected).toMatchObject({
      outcome: "rejected",
      reason: "TOO_MANY_REDIRECTS",
      stage: "url_safety",
    });

    const dnsFailed = await scanHomePage("https://missing.example", {
      lookup: async () => {
        throw new Error("ENOTFOUND");
      },
    });
    expect(dnsFailed).toMatchObject({
      outcome: "rejected",
      reason: "DNS_FAILED",
    });

    expect(connectMock()).not.toHaveBeenCalled();
  });

  it("uses BROWSERLESS_HOST when it is a bare host", async () => {
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    process.env.BROWSERLESS_HOST = "browserless.example";
    mockSession();

    await scanHomePage("https://example.com", { now: () => 0 });

    const endpoint = connectMock().mock.calls[0][0].browserWSEndpoint as string;
    expect(redactedEndpoint(endpoint)).toBe(
      "wss://browserless.example?token=[redacted]&timeout=20000",
    );
  });

  it("rejects a host value that carries a token and does not connect", async () => {
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    process.env.BROWSERLESS_HOST =
      "https://browserless.example/?token=test-browserless-key";

    const result = await scanHomePage("https://example.com");

    expect(result).toEqual({
      outcome: "config_failure",
      reason: "INVALID_BROWSERLESS_HOST",
      stage: "config",
      detail: "The scan service host is not valid.",
    });
    expect(JSON.stringify(result)).not.toContain(FAKE_KEY);
    expect(connectMock()).not.toHaveBeenCalled();
  });

  it.each([
    "http://127.0.0.1/",
    "http://169.254.169.254/",
    "http://[::127.0.0.1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[64:ff9b::7f00:1]/",
  ])(
    "rejects a redirect to %s before any Browserless connection",
    async (location) => {
      const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const requested = String(input);
        expect(requested).toBe("https://example.com/");
        expect(init?.method).toBe("HEAD");
        expect(init?.redirect).toBe("manual");
        return {
          status: 302,
          headers: {
            get: (name: string) =>
              name.toLowerCase() === "location" ? location : null,
          },
          body: { cancel: async () => undefined },
        };
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await scanHomePage("https://example.com");

      expect(result).toMatchObject({
        outcome: "rejected",
        reason: "BLOCKED_ADDRESS",
        stage: "url_safety",
      });
      expect(result.outcome).not.toBe("complete");
      expect(connectMock()).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects a redirect to a hostname that resolves to a private address", async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://example.com/");
      return {
        status: 302,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "location" ? "https://internal.example/" : null,
        },
        body: { cancel: async () => undefined },
      };
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await scanHomePage("https://example.com", {
      lookup: async (hostname) =>
        hostname === "example.com" ? ["93.184.216.34"] : ["10.0.0.5"],
    });

    expect(result).toMatchObject({
      outcome: "rejected",
      reason: "BLOCKED_ADDRESS",
    });
    expect(connectMock()).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts a main-frame navigation to a blocked IP literal", async () => {
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    const session = mockSession();
    const abort = jest.fn();
    const continued = jest.fn();
    session.goto.mockImplementation(async () => {
      const emit = (request: InterceptedRequest) => {
        for (const handler of session.requestHandlers) handler(request);
      };
      emit({
        url: () => "https://example.com/app.js",
        isNavigationRequest: () => false,
        frame: () => session.mainFrame,
        redirectChain: () => [],
        abort,
        continue: continued,
      });
      emit({
        url: () => "http://127.0.0.1/",
        isNavigationRequest: () => true,
        frame: () => session.mainFrame,
        redirectChain: () => [],
        abort,
        continue: continued,
      });
      throw new Error("net::ERR_BLOCKED_BY_CLIENT");
    });

    const result = await scanHomePage("https://example.com");

    expect(continued).toHaveBeenCalledTimes(1);
    expect(abort).toHaveBeenCalledTimes(1);
    expect(abort).toHaveBeenCalledWith("blockedbyclient");
    expect(result).toMatchObject({
      outcome: "rejected",
      reason: "BLOCKED_ADDRESS",
      stage: "url_safety",
    });
    expect(result.outcome).not.toBe("complete");
  });

  it("aborts a main-frame navigation once the redirect chain exceeds 5", async () => {
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    const session = mockSession();
    const abort = jest.fn();
    const continued = jest.fn();
    session.goto.mockImplementation(async () => {
      for (const handler of session.requestHandlers) {
        handler({
          url: () => "https://example.com/hop",
          isNavigationRequest: () => true,
          frame: () => session.mainFrame,
          redirectChain: () => Array.from({ length: 6 }),
          abort,
          continue: continued,
        });
      }
      throw new Error("net::ERR_BLOCKED_BY_CLIENT");
    });

    const result = await scanHomePage("https://example.com");

    expect(abort).toHaveBeenCalled();
    expect(continued).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      outcome: "partial",
      reason: "TOO_MANY_REDIRECTS",
      stage: "goto",
    });
    expect(result.outcome).not.toBe("complete");
  });
});
