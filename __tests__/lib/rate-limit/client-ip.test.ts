/**
 * @jest-environment node
 */

import { getClientIp, normalizeEmail } from "@/lib/rate-limit/client-ip";

describe("getClientIp", () => {
  it("extracts IP from x-forwarded-for (Vercel primary)", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.42",
    });

    expect(getClientIp(headers)).toBe("203.0.113.42");
  });

  it("extracts first IP from comma-separated x-forwarded-for", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.42, 198.51.100.1, 192.0.2.1",
    });

    expect(getClientIp(headers)).toBe("203.0.113.42");
  });

  it("falls back to x-real-ip when x-forwarded-for is missing", () => {
    const headers = new Headers({
      "x-real-ip": "203.0.113.99",
    });

    expect(getClientIp(headers)).toBe("203.0.113.99");
  });

  it("prefers x-forwarded-for over x-real-ip", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.42",
      "x-real-ip": "203.0.113.99",
    });

    expect(getClientIp(headers)).toBe("203.0.113.42");
  });

  it("returns null when no IP headers are present (fail closed)", () => {
    const headers = new Headers({});

    expect(getClientIp(headers)).toBeNull();
  });

  it("trims whitespace from x-forwarded-for", () => {
    const headers = new Headers({
      "x-forwarded-for": "  203.0.113.42  ",
    });

    expect(getClientIp(headers)).toBe("203.0.113.42");
  });

  it("trims whitespace from comma-separated list", () => {
    const headers = new Headers({
      "x-forwarded-for": " 203.0.113.42 , 198.51.100.1 ",
    });

    expect(getClientIp(headers)).toBe("203.0.113.42");
  });
});

describe("normalizeEmail", () => {
  it("lowercases email", () => {
    expect(normalizeEmail("Test@Example.COM")).toBe("test@example.com");
  });

  it("trims whitespace", () => {
    expect(normalizeEmail("  test@example.com  ")).toBe("test@example.com");
  });

  it("lowercases and trims together", () => {
    expect(normalizeEmail("  Test@Example.COM  ")).toBe("test@example.com");
  });

  it("handles already normalized email", () => {
    expect(normalizeEmail("test@example.com")).toBe("test@example.com");
  });
});
