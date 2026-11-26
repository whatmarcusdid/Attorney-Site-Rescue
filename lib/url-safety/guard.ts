import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import { CRAWLER_USER_AGENT } from "../crawler/identity";
import { URL_SAFETY_BOUNDS, type UrlSafetyBounds } from "./bounds";
import {
  hostnameIsIpLiteral,
  isBlockedHostname,
  isBlockedIp,
  unwrapHostname,
} from "./ip";
import {
  customerMessageFor,
  type UrlSafetyReasonCode,
} from "./reasons";
import {
  classifyProhibitedContent,
  type ProhibitedContentResult,
} from "./prohibited-content";

export type ProhibitedContentMatch = Extract<
  ProhibitedContentResult,
  { blocked: true }
>;

export type LookupAddresses = (hostname: string) => Promise<string[]>;

export interface RedirectProbeResult {
  status: number;
  location?: string;
}

export type ProbeRedirects = (url: string) => Promise<RedirectProbeResult>;

export interface UrlSafetyDeps {
  lookup?: LookupAddresses;
  probe?: ProbeRedirects;
  bounds?: Partial<UrlSafetyBounds>;
  /**
   * Absolute time in ms. Probe hops and DNS lookups stop when `now()`
   * reaches it. Omit it and each hop uses only connectTimeoutMs.
   */
  deadline?: number;
  now?: () => number;
  /**
   * Validate the URL, including DNS and IP checks, and do not send a
   * redirect probe. Used after a page has already loaded.
   */
  skipRedirectProbe?: boolean;
}

export type UrlSafetyResult =
  | {
      ok: true;
      normalizedUrl: string;
      finalUrl: string;
      resolvedAddresses: string[];
      bounds: UrlSafetyBounds;
    }
  | {
      ok: false;
      reasonCode: UrlSafetyReasonCode;
      customerMessage: string;
      bounds: UrlSafetyBounds;
      /** Present only for PROHIBITED_CONTENT, for structured evidence. */
      prohibited?: ProhibitedContentMatch;
    };

function fail(
  reasonCode: UrlSafetyReasonCode,
  bounds: UrlSafetyBounds,
  prohibited?: ProhibitedContentMatch,
): UrlSafetyResult {
  return {
    ok: false,
    reasonCode,
    customerMessage: customerMessageFor(reasonCode),
    bounds,
    ...(prohibited ? { prohibited } : {}),
  };
}

export function normalizeSubmittedUrl(input: string): string {
  const trimmed = input.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function mergeBounds(overrides?: Partial<UrlSafetyBounds>): UrlSafetyBounds {
  return {
    ...URL_SAFETY_BOUNDS,
    ...overrides,
    allowedPorts: overrides?.allowedPorts ?? URL_SAFETY_BOUNDS.allowedPorts,
  };
}

export function defaultLookupAddresses(hostname: string): Promise<string[]> {
  if (isIP(hostname)) {
    return Promise.resolve([hostname]);
  }

  return dns
    .lookup(hostname, { all: true, verbatim: true })
    .then((records) => records.map((record) => record.address));
}

interface ProbeHttpResponse {
  status: number;
  headers: { get(name: string): string | null };
  body: { cancel(): Promise<void> } | null;
}

class SiteTimeoutError extends Error {
  constructor() {
    super("site timed out");
    this.name = "SiteTimeoutError";
  }
}

function isTimeoutFailure(error: unknown): boolean {
  if (error instanceof SiteTimeoutError) return true;
  if (typeof error === "object" && error !== null && "name" in error) {
    const name = (error as { name?: unknown }).name;
    return (
      name === "TimeoutError" ||
      name === "AbortError" ||
      name === "SiteTimeoutError"
    );
  }
  return false;
}

function withDeadline<T>(work: Promise<T>, budgetMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      settle();
    };
    const timer = setTimeout(() => {
      finish(() => reject(new SiteTimeoutError()));
    }, budgetMs);
    work.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

async function probeOnce(
  url: string,
  method: "HEAD" | "GET",
  signal: AbortSignal,
): Promise<RedirectProbeResult> {
  const response = (await fetch(url, {
    method,
    redirect: "manual",
    signal,
    headers: {
      "User-Agent": CRAWLER_USER_AGENT,
    },
  })) as ProbeHttpResponse;
  const location = response.headers.get("location") ?? undefined;
  if (response.body) {
    await response.body.cancel().catch(() => undefined);
  }
  return {
    status: response.status,
    ...(location ? { location } : {}),
  };
}

/**
 * One hop. HEAD first, then GET only when the server rejects HEAD.
 * The connect bound covers both attempts together. The body is not read.
 * Network errors and timeouts throw so the guard loop can fail closed.
 * A timeout is SiteTimeoutError. A refused connection stays a network error.
 */
async function defaultProbe(
  url: string,
  budgetMs: number,
): Promise<RedirectProbeResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    timer = setTimeout(() => controller.abort(), budgetMs);
    const head = await probeOnce(url, "HEAD", controller.signal);
    if (head.status === 405 || head.status === 501) {
      return await probeOnce(url, "GET", controller.signal);
    }
    return head;
  } catch (error) {
    if (controller.signal.aborted || isTimeoutFailure(error)) {
      throw new SiteTimeoutError();
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Synchronous navigation check. Scheme, port, credentials, blocked hostname,
 * IP-literal address, and prohibited content. DNS is intentionally not done
 * here; the pre-flight lookup is not pinned to the later browser connection.
 */
export function checkNavigationUrl(
  input: string,
  bounds: UrlSafetyBounds = URL_SAFETY_BOUNDS,
): { ok: true } | { ok: false; reasonCode: UrlSafetyReasonCode } {
  const parsed = parseCandidate(input, bounds);
  if (!parsed.ok) return { ok: false, reasonCode: parsed.reasonCode };
  return { ok: true };
}

function parseCandidate(
  input: string,
  bounds: UrlSafetyBounds,
):
  | { ok: true; url: URL; normalizedUrl: string }
  | {
      ok: false;
      reasonCode: UrlSafetyReasonCode;
      prohibited?: ProhibitedContentMatch;
    } {
  let normalized: string;
  try {
    normalized = normalizeSubmittedUrl(input);
  } catch {
    return { ok: false, reasonCode: "INVALID_URL" };
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return { ok: false, reasonCode: "INVALID_URL" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reasonCode: "DISALLOWED_PROTOCOL" };
  }

  if (parsed.username !== "" || parsed.password !== "") {
    return { ok: false, reasonCode: "CREDENTIALS_IN_URL" };
  }

  if (!parsed.hostname) {
    return { ok: false, reasonCode: "INVALID_URL" };
  }

  const port = parsed.port
    ? Number(parsed.port)
    : parsed.protocol === "http:"
      ? 80
      : 443;
  if (!bounds.allowedPorts.includes(port)) {
    return { ok: false, reasonCode: "DISALLOWED_PORT" };
  }

  const host = unwrapHostname(parsed.hostname);

  if (isBlockedHostname(host)) {
    return { ok: false, reasonCode: "BLOCKED_HOST" };
  }

  if (hostnameIsIpLiteral(host) && isBlockedIp(host)) {
    return { ok: false, reasonCode: "BLOCKED_ADDRESS" };
  }

  // Prohibited-content pre-flight. Runs here so it applies to the submitted
  // URL and to every redirect destination, before any Browserless call.
  const prohibited = classifyProhibitedContent(parsed);
  if (prohibited.blocked) {
    return { ok: false, reasonCode: "PROHIBITED_CONTENT", prohibited };
  }

  return { ok: true, url: parsed, normalizedUrl: parsed.href };
}

async function validateResolvedAddresses(
  hostname: string,
  lookup: LookupAddresses,
): Promise<
  | { ok: true; addresses: string[] }
  | { ok: false; reasonCode: UrlSafetyReasonCode }
> {
  const host = unwrapHostname(hostname);

  if (hostnameIsIpLiteral(host)) {
    if (isBlockedIp(host)) {
      return { ok: false, reasonCode: "BLOCKED_ADDRESS" };
    }
    return { ok: true, addresses: [host] };
  }

  let addresses: string[];
  try {
    addresses = await lookup(host);
  } catch (error) {
    if (isTimeoutFailure(error)) {
      return { ok: false, reasonCode: "SITE_TIMEOUT" };
    }
    return { ok: false, reasonCode: "DNS_FAILED" };
  }

  if (addresses.length === 0) {
    return { ok: false, reasonCode: "DNS_FAILED" };
  }

  if (addresses.some((address) => isBlockedIp(address))) {
    return { ok: false, reasonCode: "BLOCKED_ADDRESS" };
  }

  return { ok: true, addresses };
}

async function validateUrlTarget(
  input: string,
  lookup: LookupAddresses,
  bounds: UrlSafetyBounds,
): Promise<
  | {
      ok: true;
      url: URL;
      normalizedUrl: string;
      addresses: string[];
    }
  | {
      ok: false;
      reasonCode: UrlSafetyReasonCode;
      prohibited?: ProhibitedContentMatch;
    }
> {
  const parsed = parseCandidate(input, bounds);
  if (!parsed.ok) return parsed;

  const resolved = await validateResolvedAddresses(parsed.url.hostname, lookup);
  if (!resolved.ok) return resolved;

  return {
    ok: true,
    url: parsed.url,
    normalizedUrl: parsed.normalizedUrl,
    addresses: resolved.addresses,
  };
}

export async function assessUrlSafety(
  input: string,
  deps: UrlSafetyDeps = {},
): Promise<UrlSafetyResult> {
  const bounds = mergeBounds(deps.bounds);
  const lookup = deps.lookup ?? defaultLookupAddresses;
  const injectedProbe = deps.probe;
  const clock = deps.now ?? Date.now;
  const hopLimit = (): number => {
    if (deps.deadline === undefined) return bounds.connectTimeoutMs;
    return Math.min(
      bounds.connectTimeoutMs,
      Math.max(0, deps.deadline - clock()),
    );
  };
  const deadlinePassed = (): boolean =>
    deps.deadline !== undefined && clock() >= deps.deadline;
  const limitedLookup: LookupAddresses = async (hostname) => {
    if (deadlinePassed() || hopLimit() <= 0) {
      throw new SiteTimeoutError();
    }
    return withDeadline(lookup(hostname), hopLimit());
  };

  if (deadlinePassed()) {
    return fail("SITE_TIMEOUT", bounds);
  }

  const initial = await validateUrlTarget(input, limitedLookup, bounds);
  if (!initial.ok) {
    return fail(initial.reasonCode, bounds, initial.prohibited);
  }

  if (deps.skipRedirectProbe) {
    return {
      ok: true,
      normalizedUrl: initial.normalizedUrl,
      finalUrl: initial.url.href,
      resolvedAddresses: initial.addresses,
      bounds,
    };
  }

  let current = initial.url.href;
  const resolvedAddresses = [...initial.addresses];

  for (let hop = 0; hop <= bounds.maxRedirects; hop += 1) {
    if (deadlinePassed() || hopLimit() <= 0) {
      return fail("SITE_TIMEOUT", bounds);
    }
    const budget = hopLimit();
    let probeResult: RedirectProbeResult;
    try {
      const work = injectedProbe
        ? injectedProbe(current)
        : defaultProbe(current, budget);
      probeResult = await withDeadline(work, budget);
    } catch (error) {
      return fail(
        isTimeoutFailure(error) ? "SITE_TIMEOUT" : "DNS_FAILED",
        bounds,
      );
    }

    const redirected =
      probeResult.status >= 300 &&
      probeResult.status < 400 &&
      Boolean(probeResult.location);

    if (!redirected) {
      return {
        ok: true,
        normalizedUrl: initial.normalizedUrl,
        finalUrl: current,
        resolvedAddresses,
        bounds,
      };
    }

    if (hop === bounds.maxRedirects) {
      return fail("TOO_MANY_REDIRECTS", bounds);
    }

    let nextUrl: string;
    try {
      nextUrl = new URL(probeResult.location as string, current).href;
    } catch {
      return fail("REDIRECT_BLOCKED", bounds);
    }

    const next = await validateUrlTarget(nextUrl, limitedLookup, bounds);
    if (!next.ok) {
      return fail(
        next.reasonCode === "INVALID_URL" ? "REDIRECT_BLOCKED" : next.reasonCode,
        bounds,
        next.prohibited,
      );
    }

    current = next.url.href;
    resolvedAddresses.push(...next.addresses);
  }

  return fail("TOO_MANY_REDIRECTS", bounds);
}
