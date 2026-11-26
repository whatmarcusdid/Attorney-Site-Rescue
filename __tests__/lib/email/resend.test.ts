/**
 * @jest-environment node
 */
jest.mock("server-only", () => ({}));

import { createHmac } from "crypto";
import { DEFAULT_FROM_EMAIL, PRODUCT_NAME, SUPPORT_EMAIL } from "@/lib/identity";
import { ResendNotConfiguredError } from "@/lib/email/provider";
import { createResendProvider } from "@/lib/email/resend";
import { verifyResendSignature } from "@/lib/email/webhook";

const FAKE_KEY = "test-resend-key";

const message = {
  to: "owner@example.com",
  subject: "TEST diagnostic email — ignore",
  text: "test",
  html: "<p>test</p>",
  idempotencyKey: "audit-1:rev-1:report_ready",
};

describe("Resend provider", () => {
  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
  });

  it("sends with the product From address and the Idempotency-Key header", async () => {
    const fetchImpl = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>(
      async () => new Response(JSON.stringify({ id: "re_123" }), { status: 200 }),
    );

    const provider = createResendProvider({
      apiKey: FAKE_KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await provider.send(message);

    expect(result).toEqual({ ok: true, providerMessageId: "re_123" });
    const [, init] = fetchImpl.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("audit-1:rev-1:report_ready");
    const body = JSON.parse(String(init?.body)) as {
      from: string;
      reply_to: string;
    };
    expect(body.from).toBe(`${PRODUCT_NAME} <${DEFAULT_FROM_EMAIL}>`);
    expect(body.from).toBe("Attorney Site Rescue <audit@attorneysiterescue.com>");
    expect(body.reply_to).toBe(SUPPORT_EMAIL);
    expect(JSON.stringify(init?.body)).not.toContain(FAKE_KEY);
  });

  it("does not call fetch when the API key is missing", async () => {
    const fetchImpl = jest.fn();
    const provider = createResendProvider({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(provider.send(message)).rejects.toBeInstanceOf(
      ResendNotConfiguredError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps the API key out of returned error strings", async () => {
    const fetchImpl = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>(
      async () => new Response("no", { status: 500 }),
    );
    const provider = createResendProvider({
      apiKey: FAKE_KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await provider.send(message);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain(FAKE_KEY);
    }
    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.stringify(init?.body)).not.toContain(FAKE_KEY);
  });
});

describe("verifyResendSignature", () => {
  const secret = "test-webhook-secret";
  const payload = '{"type":"email.delivered"}';
  const signature = createHmac("sha256", secret).update(payload).digest("hex");

  beforeEach(() => {
    delete process.env.RESEND_WEBHOOK_SECRET;
  });

  it("accepts a matching signature", () => {
    expect(verifyResendSignature(payload, signature, secret)).toBe(true);
    expect(verifyResendSignature(payload, `sha256=${signature}`, secret)).toBe(
      true,
    );
  });

  it("fails closed when the secret or header is missing", () => {
    expect(verifyResendSignature(payload, signature)).toBe(false);
    expect(verifyResendSignature(payload, signature, "")).toBe(false);
    expect(verifyResendSignature(payload, null, secret)).toBe(false);
    expect(verifyResendSignature(payload, "", secret)).toBe(false);
  });
});
