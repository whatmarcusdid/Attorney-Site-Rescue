/**
 * @jest-environment node
 */
import { CRAWLER_USER_AGENT } from "@/lib/crawler/identity";
import {
  browserlessUserAgent,
} from "@/lib/browserless/user-agent";
import {
  customerMessageForPartial,
  partialReasonForHttpStatus,
  redactProviderSecrets,
} from "@/lib/browserless/reasons";

const FAKE_KEY = "test-browserless-key";

describe("redactProviderSecrets", () => {
  const previous = process.env.BROWSERLESS_API_KEY;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.BROWSERLESS_API_KEY;
    } else {
      process.env.BROWSERLESS_API_KEY = previous;
    }
  });

  it("redacts a token query parameter", () => {
    delete process.env.BROWSERLESS_API_KEY;
    const redacted = redactProviderSecrets(
      "wss://production-sfo.browserless.io?token=test-browserless-key&timeout=20000",
    );
    expect(redacted).toBe(
      "wss://production-sfo.browserless.io?token=[redacted]&timeout=20000",
    );
    expect(redacted).not.toContain(FAKE_KEY);
  });

  it("redacts the configured key when it appears in an error string", () => {
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    const redacted = redactProviderSecrets(
      `provider rejected ${FAKE_KEY} during connect`,
    );
    expect(redacted).toBe("provider rejected [redacted] during connect");
    expect(redacted).not.toContain(FAKE_KEY);
  });

  it("redacts the URL-encoded key", () => {
    const key = "abc/def+key";
    process.env.BROWSERLESS_API_KEY = key;
    const redacted = redactProviderSecrets(
      `failed ${encodeURIComponent(key)}`,
    );
    expect(redacted).not.toContain(key);
    expect(redacted).not.toContain(encodeURIComponent(key));
    expect(redacted).toContain("[redacted]");
  });
});

describe("partial HTTP reasons", () => {
  it("maps 202, 403, and 5xx without treating them as success", () => {
    expect(partialReasonForHttpStatus(202)).toBe("HTTP_202");
    expect(partialReasonForHttpStatus(403)).toBe("HTTP_403");
    expect(partialReasonForHttpStatus(503)).toBe("HTTP_5XX");
    expect(partialReasonForHttpStatus(404)).toBe("HTTP_NON_200");
  });

  it("reuses an existing customer sentence for a blocked response", () => {
    expect(
      customerMessageForPartial({ reason: "HTTP_403", httpStatus: 403 }),
    ).toBe(
      "This website's security settings are preventing us from completing a scan",
    );
    expect(
      customerMessageForPartial({ reason: "CONNECT_TIMEOUT" }),
    ).toBe("This website could not be reached.");
    expect(
      customerMessageForPartial({ reason: "FIRST_RESULTS_BUDGET" }),
    ).toBe("This website could not be reached.");
  });
});

describe("browserlessUserAgent", () => {
  it("wraps the crawler string in the object shape", () => {
    expect(browserlessUserAgent(CRAWLER_USER_AGENT)).toEqual({
      userAgent: CRAWLER_USER_AGENT,
    });
    expect(CRAWLER_USER_AGENT.startsWith("AttorneySiteRescueBot/0.1-placeholder")).toBe(
      true,
    );
  });
});
