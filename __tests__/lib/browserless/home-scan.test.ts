/**
 * @jest-environment node
 */
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
  const page = { setUserAgent, goto, content, addScriptTag, evaluate };
  const browser = {
    newPage: jest.fn().mockResolvedValue(page),
    close,
  };
  connectMock().mockResolvedValue(browser);
  return { browser, page, close, goto, evaluate, addScriptTag, setUserAgent, content };
}

describe("scanHomePage", () => {
  beforeEach(() => {
    connectMock().mockReset();
    delete process.env.BROWSERLESS_API_KEY;
    delete process.env.BROWSERLESS_HOST;
  });

  afterEach(() => {
    jest.useRealTimers();
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
    connectMock().mockImplementation(() => new Promise(() => undefined));

    const pending = scanHomePage("https://example.com");
    await jest.advanceTimersByTimeAsync(URL_SAFETY_BOUNDS.connectTimeoutMs);
    const result = await pending;

    expect(result).toMatchObject({
      outcome: "partial",
      reason: "CONNECT_TIMEOUT",
      stage: "connect",
    });
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
});
