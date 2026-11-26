/**
 * @jest-environment node
 */
import { CRAWLER_USER_AGENT } from "@/lib/crawler/identity";
import {
  assessUrlSafety,
  customerMessageFor,
  URL_SAFETY_BOUNDS,
  URL_SAFETY_REASON_CODES,
} from "@/lib/url-safety";

const PUBLIC_IP = "93.184.216.34";

function lookupOf(addresses: string[]) {
  return async () => addresses;
}

function probeResponse(status: number, location?: string) {
  return {
    status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "location" ? (location ?? null) : null,
    },
    body: { cancel: async () => undefined },
  };
}

describe("assessUrlSafety", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn(async () => probeResponse(200)) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it("normalizes a bare domain to https and allows a public host", async () => {
    const result = await assessUrlSafety("example.com", {
      lookup: lookupOf([PUBLIC_IP]),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.normalizedUrl).toBe("https://example.com/");
      expect(result.bounds).toEqual(URL_SAFETY_BOUNDS);
      expect(result.bounds.maxRedirects).toBe(5);
      expect(result.bounds.maxResponseBytes).toBe(1_048_576);
      expect(result.bounds.connectTimeoutMs).toBe(2_000);
      expect(result.bounds.gotoTargetMs).toBe(5_000);
      expect(result.bounds.gotoHardTimeoutMs).toBe(8_000);
      expect(result.bounds.axeMinRemainingMs).toBe(2_500);
      expect(result.bounds.firstResultsBudgetMs).toBe(15_000);
    }
  });

  it("rejects credentials embedded in the URL", async () => {
    const result = await assessUrlSafety("https://user:pass@example.com", {
      lookup: lookupOf([PUBLIC_IP]),
    });
    expect(result).toMatchObject({
      ok: false,
      reasonCode: "CREDENTIALS_IN_URL",
    });
    if (!result.ok) {
      expect(result.customerMessage).not.toContain("user");
      expect(result.customerMessage).not.toContain("pass");
    }
  });

  it("rejects a disallowed protocol", async () => {
    const result = await assessUrlSafety("ftp://example.com");
    expect(result).toMatchObject({
      ok: false,
      reasonCode: "DISALLOWED_PROTOCOL",
    });
  });

  it("rejects a disallowed port", async () => {
    const result = await assessUrlSafety("https://example.com:8080", {
      lookup: lookupOf([PUBLIC_IP]),
    });
    expect(result).toMatchObject({
      ok: false,
      reasonCode: "DISALLOWED_PORT",
    });
  });

  it("rejects localhost by name", async () => {
    const result = await assessUrlSafety("http://localhost", {
      lookup: lookupOf(["127.0.0.1"]),
    });
    expect(result).toMatchObject({ ok: false, reasonCode: "BLOCKED_HOST" });
  });

  it("rejects loopback IPv4", async () => {
    const result = await assessUrlSafety("http://127.0.0.1");
    expect(result).toMatchObject({ ok: false, reasonCode: "BLOCKED_ADDRESS" });
  });

  it.each([
    ["10.0.0.0/8", "http://10.1.2.3"],
    ["172.16.0.0/12", "http://172.16.4.5"],
    ["192.168.0.0/16", "http://192.168.10.20"],
    ["100.64.0.0/10 CGNAT", "http://100.64.0.1"],
    ["169.254.0.0/16 link-local", "http://169.254.1.1"],
    ["169.254.169.254 metadata", "http://169.254.169.254"],
    ["224.0.0.0/4 multicast", "http://224.0.0.1"],
    ["240.0.0.0/4 reserved", "http://240.0.0.1"],
  ])("rejects private/special IPv4 %s", async (_label, url) => {
    const result = await assessUrlSafety(url);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("BLOCKED_ADDRESS");
      expect(result.customerMessage).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    }
  });

  it.each([
    ["loopback", "http://[::1]"],
    ["link-local", "http://[fe80::1]"],
    ["unique-local", "http://[fd12:3456:789a:1::1]"],
    ["multicast", "http://[ff02::1]"],
    ["IPv4-mapped private", "http://[::ffff:192.168.0.10]"],
  ])("rejects IPv6 %s", async (_label, url) => {
    const result = await assessUrlSafety(url);
    expect(result).toMatchObject({ ok: false, reasonCode: "BLOCKED_ADDRESS" });
  });

  it("rejects a public hostname that resolves to a private IP", async () => {
    const result = await assessUrlSafety("https://shop.example.com", {
      lookup: lookupOf(["10.0.0.8"]),
    });
    expect(result).toMatchObject({
      ok: false,
      reasonCode: "BLOCKED_ADDRESS",
    });
    if (!result.ok) {
      expect(result.customerMessage).not.toContain("10.0.0.8");
      expect(result.customerMessage).toBe(
        customerMessageFor("BLOCKED_ADDRESS"),
      );
    }
  });

  it("rejects when any resolved address is private", async () => {
    const result = await assessUrlSafety("https://shop.example.com", {
      lookup: lookupOf([PUBLIC_IP, "192.168.1.4"]),
    });
    expect(result).toMatchObject({ ok: false, reasonCode: "BLOCKED_ADDRESS" });
  });

  it("rejects a redirect whose destination is private", async () => {
    const result = await assessUrlSafety("https://example.com", {
      lookup: async (hostname) =>
        hostname === "example.com" ? [PUBLIC_IP] : ["192.168.0.2"],
      probe: async (url) =>
        url.startsWith("https://example.com")
          ? { status: 302, location: "https://internal.example.com/admin" }
          : { status: 200 },
    });
    expect(result).toMatchObject({
      ok: false,
      reasonCode: "BLOCKED_ADDRESS",
    });
  });

  it("rejects when the redirect hop count is exceeded", async () => {
    let hop = 0;
    const result = await assessUrlSafety("https://example.com", {
      lookup: lookupOf([PUBLIC_IP]),
      bounds: { maxRedirects: 2 },
      probe: async () => {
        hop += 1;
        return { status: 302, location: `https://example.com/r${hop}` };
      },
    });
    expect(result).toMatchObject({
      ok: false,
      reasonCode: "TOO_MANY_REDIRECTS",
    });
  });

  it("revalidates each redirect destination before following it", async () => {
    const seen: string[] = [];
    const result = await assessUrlSafety("https://example.com/start", {
      lookup: lookupOf([PUBLIC_IP]),
      probe: async (url) => {
        seen.push(url);
        if (url.includes("/start")) {
          return { status: 301, location: "https://cdn.example.com/ok" };
        }
        return { status: 200 };
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.finalUrl).toBe("https://cdn.example.com/ok");
    }
    expect(seen[0]).toContain("example.com/start");
  });

  it("rejects DNS resolution failures without leaking lookup details", async () => {
    const result = await assessUrlSafety("https://missing.example", {
      lookup: async () => {
        throw new Error("ENOTFOUND 10.0.0.9");
      },
    });
    expect(result).toMatchObject({ ok: false, reasonCode: "DNS_FAILED" });
    if (!result.ok) {
      expect(result.customerMessage).not.toContain("10.0.0.9");
      expect(result.customerMessage).not.toContain("ENOTFOUND");
    }
  });

  it("allows five redirects and rejects a sixth", async () => {
    let allowedHops = 0;
    const allowed = await assessUrlSafety("https://example.com/start", {
      lookup: lookupOf([PUBLIC_IP]),
      probe: async () => {
        allowedHops += 1;
        if (allowedHops <= 5) {
          return { status: 302, location: `https://example.com/hop${allowedHops}` };
        }
        return { status: 200 };
      },
    });
    expect(allowed.ok).toBe(true);
    if (allowed.ok) {
      expect(allowed.finalUrl).toBe("https://example.com/hop5");
    }

    let rejectedHops = 0;
    const rejected = await assessUrlSafety("https://example.com/start", {
      lookup: lookupOf([PUBLIC_IP]),
      probe: async () => {
        rejectedHops += 1;
        return {
          status: 302,
          location: `https://example.com/hop${rejectedHops}`,
        };
      },
    });
    expect(rejected).toMatchObject({
      ok: false,
      reasonCode: "TOO_MANY_REDIRECTS",
    });
  });

  it("probes each hop with HEAD and does not request a blocked redirect target", async () => {
    const seen: string[] = [];
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(String(input));
      expect(init?.redirect).toBe("manual");
      expect(init?.method).toBe("HEAD");
      if (seen.length === 1) return probeResponse(302, "http://169.254.169.254/latest");
      throw new Error("probed the blocked hop");
    }) as unknown as typeof fetch;

    const result = await assessUrlSafety("https://example.com/start", {
      lookup: lookupOf([PUBLIC_IP]),
    });

    expect(result).toMatchObject({ ok: false, reasonCode: "BLOCKED_ADDRESS" });
    expect(seen).toEqual(["https://example.com/start"]);
  });

  it.each([405, 501])(
    "falls back from HEAD to GET when HEAD returns %s",
    async (status) => {
      const methods: string[] = [];
      global.fetch = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        methods.push(init?.method ?? "");
        if (init?.method === "HEAD") return probeResponse(status);
        return probeResponse(200);
      }) as unknown as typeof fetch;

      const result = await assessUrlSafety("https://example.com", {
        lookup: lookupOf([PUBLIC_IP]),
      });

      expect(result.ok).toBe(true);
      expect(methods).toEqual(["HEAD", "GET"]);
    },
  );

  it("returns a safety result when the probe times out", async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "TimeoutError" }));
        });
      });
    }) as unknown as typeof fetch;

    const pending = assessUrlSafety("https://example.com", {
      lookup: lookupOf([PUBLIC_IP]),
    });
    await jest.advanceTimersByTimeAsync(URL_SAFETY_BOUNDS.connectTimeoutMs);
    const result = await pending;

    expect(result).toMatchObject({
      ok: false,
      reasonCode: "SITE_TIMEOUT",
      customerMessage: "This website took too long to respond.",
    });
  });

  it("returns SITE_TIMEOUT when an injected hop hangs past the connect bound", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    const pending = assessUrlSafety("https://example.com", {
      now: () => Date.now(),
      deadline: URL_SAFETY_BOUNDS.firstResultsBudgetMs,
      lookup: lookupOf([PUBLIC_IP]),
      probe: () => new Promise(() => undefined),
    });
    await jest.advanceTimersByTimeAsync(URL_SAFETY_BOUNDS.connectTimeoutMs);
    const result = await pending;

    expect(Date.now()).toBe(URL_SAFETY_BOUNDS.connectTimeoutMs);

    expect(result).toMatchObject({
      ok: false,
      reasonCode: "SITE_TIMEOUT",
      customerMessage: "This website took too long to respond.",
    });
  });

  it("returns DNS_FAILED when an injected hop is refused", async () => {
    const result = await assessUrlSafety("https://example.com", {
      now: () => 0,
      lookup: lookupOf([PUBLIC_IP]),
      probe: async () => {
        throw Object.assign(new Error("connect ECONNREFUSED"), {
          code: "ECONNREFUSED",
        });
      },
    });

    expect(result).toMatchObject({ ok: false, reasonCode: "DNS_FAILED" });
  });

  it("returns SITE_TIMEOUT when DNS hangs past the connect bound", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    let settled = false;
    const pending = assessUrlSafety("https://example.com", {
      now: () => Date.now(),
      deadline: URL_SAFETY_BOUNDS.firstResultsBudgetMs,
      lookup: () =>
        new Promise((resolve) => {
          setTimeout(() => resolve([PUBLIC_IP]), 3000);
        }),
    }).then((result) => {
      settled = true;
      return result;
    });

    await jest.advanceTimersByTimeAsync(URL_SAFETY_BOUNDS.connectTimeoutMs);
    const result = await pending;

    expect(settled).toBe(true);
    expect(Date.now()).toBe(URL_SAFETY_BOUNDS.connectTimeoutMs);
    expect(result).toMatchObject({
      ok: false,
      reasonCode: "SITE_TIMEOUT",
      customerMessage: "This website took too long to respond.",
    });
    await jest.advanceTimersByTimeAsync(1000);
  });

  it("sends the crawler User-Agent on the redirect probe", async () => {
    let userAgent: string | undefined;
    global.fetch = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      userAgent = headers?.["User-Agent"];
      return probeResponse(200);
    }) as unknown as typeof fetch;

    const result = await assessUrlSafety("https://example.com", {
      lookup: lookupOf([PUBLIC_IP]),
    });

    expect(result.ok).toBe(true);
    expect(userAgent).toBe(CRAWLER_USER_AGENT);
  });

  it("lists every safety reason code, including SITE_TIMEOUT", () => {
    expect([...URL_SAFETY_REASON_CODES]).toEqual([
      "INVALID_URL",
      "DISALLOWED_PROTOCOL",
      "DISALLOWED_PORT",
      "CREDENTIALS_IN_URL",
      "BLOCKED_HOST",
      "BLOCKED_ADDRESS",
      "DNS_FAILED",
      "SITE_TIMEOUT",
      "REDIRECT_BLOCKED",
      "TOO_MANY_REDIRECTS",
      "PROHIBITED_CONTENT",
    ]);
    expect(customerMessageFor("SITE_TIMEOUT")).toBe(
      "This website took too long to respond.",
    );
  });

  it("returns a safety result when the probe hits a network error", async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;

    const result = await assessUrlSafety("https://example.com", {
      lookup: lookupOf([PUBLIC_IP]),
    });

    expect(result).toMatchObject({ ok: false, reasonCode: "DNS_FAILED" });
  });
});
