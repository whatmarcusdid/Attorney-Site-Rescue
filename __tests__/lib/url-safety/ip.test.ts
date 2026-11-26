/**
 * @jest-environment node
 */
import { assessUrlSafety } from "@/lib/url-safety/guard";
import { isBlockedIp, isBlockedIPv4, isBlockedIPv6 } from "@/lib/url-safety/ip";

describe("blocked IPv4 special-use ranges", () => {
  it.each([
    ["192.0.0.0/24", "192.0.0.1"],
    ["192.0.2.0/24", "192.0.2.1"],
    ["198.18.0.0/15", "198.18.0.1"],
    ["198.18.0.0/15 upper half", "198.19.255.1"],
    ["198.51.100.0/24", "198.51.100.1"],
    ["203.0.113.0/24", "203.0.113.1"],
    ["240.0.0.0/4", "240.0.0.1"],
  ])("blocks %s via %s", (_label, ip) => {
    expect(isBlockedIPv4(ip)).toBe(true);
    expect(isBlockedIp(ip)).toBe(true);
  });

  it("does not treat 192.0.1.1 as part of 192.0.0.0/24", () => {
    expect(isBlockedIPv4("192.0.1.1")).toBe(false);
  });
});

describe("blocked IPv6 forms", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it.each([
    "::127.0.0.1",
    "[::127.0.0.1]",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "64:ff9b::7f00:1",
    "64:ff9b::808:808",
    "64:ff9b:1::808:808",
    "2002:808:808::1",
    "::",
    "::1",
    "ff00::1",
  ])("blocks %s", (ip) => {
    expect(isBlockedIPv6(ip)).toBe(true);
  });

  it("allows a public IPv6 address", () => {
    expect(isBlockedIPv6("2606:4700:4700::1111")).toBe(false);
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false);
  });

  it("rejects bracketed IPv6 literals through the guard without probing them", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const blocked = await assessUrlSafety("http://[::127.0.0.1]/");
    expect(blocked).toMatchObject({ ok: false, reasonCode: "BLOCKED_ADDRESS" });
    expect(fetchMock).not.toHaveBeenCalled();

    global.fetch = jest.fn(async () => ({
      status: 200,
      headers: { get: () => null },
      body: { cancel: async () => undefined },
    })) as unknown as typeof fetch;
    const allowed = await assessUrlSafety("https://[2606:4700:4700::1111]/");
    expect(allowed.ok).toBe(true);
  });
});
