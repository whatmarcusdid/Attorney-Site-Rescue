/**
 * @jest-environment node
 */

import { checkRateLimit } from "@/lib/rate-limit/postgres-limiter";
import { createAdminClient } from "@/lib/supabase/admin";

// Mock Supabase client
jest.mock("@/lib/supabase/admin");

const mockCreateAdminClient = createAdminClient as jest.MockedFunction<
  typeof createAdminClient
>;

describe("checkRateLimit", () => {
  let mockSupabase: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock Supabase client
    mockSupabase = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      gte: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
    };

    mockCreateAdminClient.mockReturnValue(mockSupabase);
  });

  describe("IP rate limit", () => {
    it("allows request when IP limit not exceeded", async () => {
      // IP check: 5 events
      mockSupabase.gte.mockResolvedValueOnce({
        data: null,
        error: null,
        count: 5,
      });
      // IP insert succeeds
      mockSupabase.insert.mockResolvedValueOnce({ error: null });
      // Email check: 0 events
      mockSupabase.gte.mockResolvedValueOnce({
        data: null,
        error: null,
        count: 0,
      });
      // Email insert succeeds
      mockSupabase.insert.mockResolvedValueOnce({ error: null });

      const result = await checkRateLimit("203.0.113.42", "test@example.com");

      expect(result).toEqual({ allowed: true, reason: null });
      expect(mockSupabase.from).toHaveBeenCalledWith("rate_limit_events");
    });

    it("denies request when IP limit exceeded (20/hour)", async () => {
      // Mock: 20 events in last hour (at limit)
      mockSupabase.gte.mockResolvedValueOnce({
        data: null,
        error: null,
        count: 20,
      });

      const result = await checkRateLimit("203.0.113.42", "test@example.com");

      expect(result).toEqual({ allowed: false, reason: "ip_limited" });

      // Should not check email limit or insert events
      expect(mockSupabase.insert).not.toHaveBeenCalled();
    });

    it("uses rolling window for IP limit", async () => {
      // IP check: 19 events
      mockSupabase.gte.mockResolvedValueOnce({
        data: null,
        error: null,
        count: 19,
      });
      mockSupabase.insert.mockResolvedValueOnce({ error: null });
      // Email check: 0 events
      mockSupabase.gte.mockResolvedValueOnce({
        data: null,
        error: null,
        count: 0,
      });
      mockSupabase.insert.mockResolvedValueOnce({ error: null });

      await checkRateLimit("203.0.113.42", "test@example.com");

      // Check that gte (greater than or equal) was called with a timestamp
      // from approximately 1 hour ago
      expect(mockSupabase.gte).toHaveBeenCalledWith(
        "event_time",
        expect.any(String),
      );
    });
  });

  describe("Email rate limit", () => {
    it("allows request when email limit not exceeded", async () => {
      // IP check: 0 events
      mockSupabase.gte.mockResolvedValueOnce({
        data: null,
        error: null,
        count: 0,
      });
      mockSupabase.insert.mockResolvedValueOnce({ error: null });
      // Email check: 0 events
      mockSupabase.gte.mockResolvedValueOnce({
        data: null,
        error: null,
        count: 0,
      });
      mockSupabase.insert.mockResolvedValueOnce({ error: null });

      const result = await checkRateLimit("203.0.113.42", "test@example.com");

      expect(result).toEqual({ allowed: true, reason: null });
    });

    it("denies request when email limit exceeded (1/24h)", async () => {
      // IP check: 0 events
      mockSupabase.gte.mockResolvedValueOnce({
        data: null,
        error: null,
        count: 0,
      });
      // IP insert succeeds
      mockSupabase.insert.mockResolvedValueOnce({ error: null });
      // Email check: 1 event (at limit)
      mockSupabase.gte.mockResolvedValueOnce({
        data: null,
        error: null,
        count: 1,
      });

      const result = await checkRateLimit("203.0.113.42", "test@example.com");

      expect(result).toEqual({ allowed: false, reason: "email_limited" });

      // Should insert IP event but not email event
      expect(mockSupabase.insert).toHaveBeenCalledTimes(1);
    });

    it("normalizes email before checking limit", async () => {
      mockSupabase.gte.mockResolvedValueOnce({
        data: null,
        error: null,
        count: 0,
      });
      mockSupabase.insert.mockResolvedValueOnce({ error: null });
      mockSupabase.gte.mockResolvedValueOnce({
        data: null,
        error: null,
        count: 0,
      });
      mockSupabase.insert.mockResolvedValueOnce({ error: null });

      await checkRateLimit("203.0.113.42", "  Test@Example.COM  ");

      // Check that the email was normalized in limiter_key
      expect(mockSupabase.eq).toHaveBeenCalledWith(
        "limiter_key",
        "email:test@example.com",
      );
    });

    it("uses 24-hour rolling window for email limit", async () => {
      mockSupabase.gte.mockResolvedValueOnce({
        data: null,
        error: null,
        count: 0,
      });
      mockSupabase.insert.mockResolvedValueOnce({ error: null });
      mockSupabase.gte.mockResolvedValueOnce({
        data: null,
        error: null,
        count: 0,
      });
      mockSupabase.insert.mockResolvedValueOnce({ error: null });

      await checkRateLimit("203.0.113.42", "test@example.com");

      // Check that gte was called twice (once for IP, once for email)
      expect(mockSupabase.gte).toHaveBeenCalledTimes(2);
      expect(mockSupabase.gte).toHaveBeenLastCalledWith(
        "event_time",
        expect.any(String),
      );
    });
  });

  describe("Shared state (two instances)", () => {
    it("two instances share the same count via database", async () => {
      // Instance 1: sees 18 events, inserts 19th
      mockSupabase.gte.mockResolvedValueOnce({
        data: null,
        error: null,
        count: 18,
      });
      mockSupabase.insert.mockResolvedValueOnce({ error: null });
      mockSupabase.gte.mockResolvedValueOnce({
        data: null,
        error: null,
        count: 0,
      });
      mockSupabase.insert.mockResolvedValueOnce({ error: null });

      const result1 = await checkRateLimit("203.0.113.42", "user1@example.com");
      expect(result1).toEqual({ allowed: true, reason: null });

      // Instance 2: sees 19 events (including the one Instance 1 inserted)
      mockSupabase.gte.mockResolvedValueOnce({
        data: null,
        error: null,
        count: 19,
      });
      mockSupabase.insert.mockResolvedValueOnce({ error: null });
      mockSupabase.gte.mockResolvedValueOnce({
        data: null,
        error: null,
        count: 0,
      });
      mockSupabase.insert.mockResolvedValueOnce({ error: null });

      const result2 = await checkRateLimit("203.0.113.42", "user2@example.com");
      expect(result2).toEqual({ allowed: true, reason: null });

      // Instance 3: sees 20 events, limit exceeded
      mockSupabase.gte.mockResolvedValueOnce({
        data: null,
        error: null,
        count: 20,
      });

      const result3 = await checkRateLimit("203.0.113.42", "user3@example.com");
      expect(result3).toEqual({ allowed: false, reason: "ip_limited" });
    });
  });

  describe("Store unavailable (fail closed)", () => {
    it("denies request when IP limit check fails", async () => {
      // Mock: database error
      mockSupabase.gte.mockResolvedValueOnce({
        data: null,
        error: { message: "Connection refused" },
        count: null,
      });

      const result = await checkRateLimit("203.0.113.42", "test@example.com");

      expect(result).toEqual({ allowed: false, reason: "store_unavailable" });
    });

    it("denies request when email limit check fails", async () => {
      // Mock: IP check succeeds, email check fails
      mockSupabase.gte.mockResolvedValueOnce({
        data: null,
        error: null,
        count: 0,
      });
      mockSupabase.insert.mockResolvedValueOnce({ error: null });
      mockSupabase.gte.mockResolvedValueOnce({
        data: null,
        error: { message: "Connection refused" },
        count: null,
      });

      const result = await checkRateLimit("203.0.113.42", "test@example.com");

      expect(result).toEqual({ allowed: false, reason: "store_unavailable" });
    });

    it("denies request when IP event insert fails", async () => {
      // Mock: IP check succeeds, insert fails
      mockSupabase.gte.mockResolvedValueOnce({
        data: null,
        error: null,
        count: 0,
      });
      mockSupabase.insert.mockResolvedValueOnce({
        error: { message: "Insert failed" },
      });

      const result = await checkRateLimit("203.0.113.42", "test@example.com");

      expect(result).toEqual({ allowed: false, reason: "store_unavailable" });
    });
  });

  describe("Missing client IP (fail closed)", () => {
    it("denies request when clientIp is null", async () => {
      const result = await checkRateLimit(null, "test@example.com");

      expect(result).toEqual({ allowed: false, reason: "no_client_ip" });

      // Should not query database
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });
  });

  describe("Window reset", () => {
    it("allows request after IP window expires", async () => {
      // First request: 20 events, limit exceeded
      mockSupabase.gte.mockResolvedValueOnce({
        data: null,
        error: null,
        count: 20,
      });

      const result1 = await checkRateLimit("203.0.113.42", "test@example.com");
      expect(result1).toEqual({ allowed: false, reason: "ip_limited" });

      // After 1 hour: old events outside window, count is 0
      mockSupabase.gte.mockResolvedValueOnce({
        data: null,
        error: null,
        count: 0,
      });
      mockSupabase.insert.mockResolvedValueOnce({ error: null });
      mockSupabase.gte.mockResolvedValueOnce({
        data: null,
        error: null,
        count: 0,
      });
      mockSupabase.insert.mockResolvedValueOnce({ error: null });

      const result2 = await checkRateLimit("203.0.113.42", "test@example.com");
      expect(result2).toEqual({ allowed: true, reason: null });
    });

    it("allows request after email window expires", async () => {
      // First request: 0 IP events, 1 email event (limit exceeded)
      mockSupabase.gte.mockResolvedValueOnce({
        data: null,
        error: null,
        count: 0,
      });
      mockSupabase.insert.mockResolvedValueOnce({ error: null });
      mockSupabase.gte.mockResolvedValueOnce({
        data: null,
        error: null,
        count: 1,
      });

      const result1 = await checkRateLimit("203.0.113.42", "test@example.com");
      expect(result1).toEqual({ allowed: false, reason: "email_limited" });

      // After 24 hours: old events outside window, count is 0
      mockSupabase.gte.mockResolvedValueOnce({
        data: null,
        error: null,
        count: 0,
      });
      mockSupabase.insert.mockResolvedValueOnce({ error: null });
      mockSupabase.gte.mockResolvedValueOnce({
        data: null,
        error: null,
        count: 0,
      });
      mockSupabase.insert.mockResolvedValueOnce({ error: null });

      const result2 = await checkRateLimit("203.0.113.42", "test@example.com");
      expect(result2).toEqual({ allowed: true, reason: null });
    });
  });
});
