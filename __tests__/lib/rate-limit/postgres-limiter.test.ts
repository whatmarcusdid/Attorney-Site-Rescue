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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockSupabase: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock Supabase client with rpc method
    mockSupabase = {
      rpc: jest.fn(),
    };

    mockCreateAdminClient.mockReturnValue(mockSupabase);
  });

  describe("IP rate limit", () => {
    it("allows request when IP limit not exceeded", async () => {
      // Mock: IP check returns allowed
      mockSupabase.rpc
        .mockResolvedValueOnce({
          data: { allowed: true, reason: null, count: 5, limit: 20 },
          error: null,
        })
        // Mock: Email check returns allowed
        .mockResolvedValueOnce({
          data: { allowed: true, reason: null, count: 0, limit: 1 },
          error: null,
        });

      const result = await checkRateLimit("203.0.113.42", "test@example.com");

      expect(result).toEqual({ allowed: true, reason: null });
      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        "check_and_record_rate_limit",
        expect.objectContaining({
          p_limiter_key: "ip:203.0.113.42",
          p_limit_type: "ip_hourly",
          p_limit: 20,
        }),
      );
    });

    it("denies request when IP limit exceeded (20/hour)", async () => {
      // Mock: IP check returns denied
      mockSupabase.rpc.mockResolvedValueOnce({
        data: { allowed: false, reason: "ip_limited", count: 20, limit: 20 },
        error: null,
      });

      const result = await checkRateLimit("203.0.113.42", "test@example.com");

      expect(result).toEqual({ allowed: false, reason: "ip_limited" });
      // Should not check email limit
      expect(mockSupabase.rpc).toHaveBeenCalledTimes(1);
    });
  });

  describe("Email rate limit", () => {
    it("allows request when email limit not exceeded", async () => {
      mockSupabase.rpc
        .mockResolvedValueOnce({
          data: { allowed: true, reason: null, count: 0, limit: 20 },
          error: null,
        })
        .mockResolvedValueOnce({
          data: { allowed: true, reason: null, count: 0, limit: 1 },
          error: null,
        });

      const result = await checkRateLimit("203.0.113.42", "test@example.com");

      expect(result).toEqual({ allowed: true, reason: null });
    });

    it("denies request when email limit exceeded (1/24h)", async () => {
      mockSupabase.rpc
        .mockResolvedValueOnce({
          data: { allowed: true, reason: null, count: 0, limit: 20 },
          error: null,
        })
        .mockResolvedValueOnce({
          data: { allowed: false, reason: "email_limited", count: 1, limit: 1 },
          error: null,
        });

      const result = await checkRateLimit("203.0.113.42", "test@example.com");

      expect(result).toEqual({ allowed: false, reason: "email_limited" });
    });

    it("normalizes email before checking limit", async () => {
      mockSupabase.rpc
        .mockResolvedValueOnce({
          data: { allowed: true, reason: null, count: 0, limit: 20 },
          error: null,
        })
        .mockResolvedValueOnce({
          data: { allowed: true, reason: null, count: 0, limit: 1 },
          error: null,
        });

      await checkRateLimit("203.0.113.42", "  Test@Example.COM  ");

      // Check that the email was normalized in limiter_key
      expect(mockSupabase.rpc).toHaveBeenLastCalledWith(
        "check_and_record_rate_limit",
        expect.objectContaining({
          p_limiter_key: "email:test@example.com",
        }),
      );
    });
  });

  describe("Store unavailable (fail closed)", () => {
    it("denies request when IP limit check fails", async () => {
      // Mock: database error
      mockSupabase.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: "Connection refused" },
      });

      const result = await checkRateLimit("203.0.113.42", "test@example.com");

      expect(result).toEqual({ allowed: false, reason: "store_unavailable" });
    });

    it("denies request when email limit check fails", async () => {
      mockSupabase.rpc
        .mockResolvedValueOnce({
          data: { allowed: true, reason: null, count: 0, limit: 20 },
          error: null,
        })
        .mockResolvedValueOnce({
          data: null,
          error: { message: "Connection refused" },
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
      expect(mockSupabase.rpc).not.toHaveBeenCalled();
    });
  });
});
