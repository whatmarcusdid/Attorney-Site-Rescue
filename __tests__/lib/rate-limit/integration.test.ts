/**
 * @jest-environment node
 */

/**
 * Integration test for rate limiter concurrency safety.
 *
 * Tests against real Postgres database to prove:
 * 1. Two concurrent requests don't both pass the same limit
 * 2. Advisory locks prevent race conditions
 * 3. Email limit (1/24h) holds on double submit
 *
 * Requires: PostgreSQL with migrations applied
 * Run: Set env vars or use local postgres, then run test
 */

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - pg types not installed (dev dependency only)
import { Pool } from "pg";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/attorney_site_rescue_test";

// Skip integration tests in CI unless explicitly enabled
const describeIfDb = process.env.RUN_INTEGRATION_TESTS ? describe : describe.skip;

describeIfDb("Rate Limiter Integration (Real Postgres)", () => {
  let pool: Pool;

  // Helper function to execute queries as service_role
  async function queryAsServiceRole(text: string, params?: unknown[]) {
    const client = await pool.connect();
    try {
      await client.query('SET ROLE service_role');
      await client.query('SET search_path = public');
      return await client.query(text, params);
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    // Pool allows concurrent connections (each query gets its own connection)
    pool = new Pool({
      connectionString: TEST_DB_URL,
      max: 30, // Support up to 30 concurrent requests
    });

    // Create service_role if it doesn't exist (for throwaway Postgres)
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
          CREATE ROLE service_role NOLOGIN BYPASSRLS;
        END IF;
      END $$;
    `);

    // Grant necessary permissions to service_role
    await pool.query(`GRANT USAGE ON SCHEMA public TO service_role`);
    await pool.query(`GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role`);
    await pool.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role`);

    // Verify function exists and service_role can call it
    // Test connection sets role to service_role
    const client = await pool.connect();
    try {
      await client.query('SET ROLE service_role');
      const { rows } = await client.query(
        "SELECT 1 FROM pg_proc WHERE proname = 'check_and_record_rate_limit'",
      );
      if (rows.length === 0) {
        throw new Error(
          "check_and_record_rate_limit function not found. Apply migrations first.",
        );
      }
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    // Cleanup test events
    await queryAsServiceRole(
      "DELETE FROM rate_limit_events WHERE email LIKE 'test%' OR limiter_key LIKE 'ip:203.0.113.%'",
    );
    await pool.end();
  });

  beforeEach(async () => {
    // Clean up before each test
    await queryAsServiceRole(
      "DELETE FROM rate_limit_events WHERE email LIKE 'test-%' OR limiter_key LIKE 'ip:203.0.113.%'",
    );
  });

  describe("Concurrent requests (atomic safety)", () => {
    it("only allows 1 email per 24h even with concurrent double submit (20 rounds)", async () => {
      // Run 20 rounds to catch intermittent race conditions
      // Without advisory lock, some rounds would let both requests pass
      const rounds = 20;
      let totalRounds = 0;
      let passedRounds = 0;

      for (let round = 0; round < rounds; round++) {
        const testEmail = `test-concurrent-${Date.now()}-${round}@example.com`;
        const testIp = "203.0.113.100";
        const limiterKey = `email:${testEmail}`;

      // Simulate double submit: two requests at exact same time
      // Pool gives each query its own connection → true concurrency
      const [result1, result2] = await Promise.all([
        queryAsServiceRole("SELECT check_and_record_rate_limit($1, $2, $3, $4, $5, $6, $7)", [
          limiterKey,
          "email_daily",
          1,
          24 * 60 * 60 * 1000,
          testIp,
          testEmail,
          "test-agent",
        ]),
        queryAsServiceRole("SELECT check_and_record_rate_limit($1, $2, $3, $4, $5, $6, $7)", [
          limiterKey,
          "email_daily",
          1,
          24 * 60 * 60 * 1000,
          testIp,
          testEmail,
          "test-agent",
        ]),
      ]);

        const data1 = result1.rows[0].check_and_record_rate_limit;
        const data2 = result2.rows[0].check_and_record_rate_limit;

        // Count how many were allowed
        const allowedCount = (data1.allowed ? 1 : 0) + (data2.allowed ? 1 : 0);
        
        totalRounds++;
        if (allowedCount === 1) {
          passedRounds++;
        }

        // Exactly one should be allowed in every round
        expect(allowedCount).toBe(1);

      // Verify only 1 event was recorded
      const { rows: countRows } = await queryAsServiceRole(
        "SELECT COUNT(*) FROM rate_limit_events WHERE email = $1",
        [testEmail],
      );
      expect(parseInt(countRows[0].count)).toBe(1);

        // Small delay between rounds to avoid connection pool exhaustion
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      // All rounds should pass with advisory lock
      expect(passedRounds).toBe(totalRounds);
    });

    it("allows exactly 20 IP requests even with concurrent bursts", async () => {
      const testIp = `203.0.113.${Math.floor(Math.random() * 200) + 10}`;
      const limiterKey = `ip:${testIp}`;

      // Send 25 concurrent requests (exceeds limit of 20)
      // Pool gives each query its own connection → true concurrency
      const requests = Array.from({ length: 25 }, (_, i) =>
        queryAsServiceRole("SELECT check_and_record_rate_limit($1, $2, $3, $4, $5, $6, $7)", [
          limiterKey,
          "ip_hourly",
          20,
          60 * 60 * 1000,
          testIp,
          `burst-test-${i}@example.com`,
          "test-agent",
        ]),
      );

      const results = await Promise.all(requests);
      const data = results.map(
        (r: { rows: { check_and_record_rate_limit: { allowed: boolean; reason: string } }[] }) =>
          r.rows[0].check_and_record_rate_limit,
      );

      // Count how many were allowed
      const allowedCount = data.filter(
        (r: { allowed: boolean }) => r.allowed,
      ).length;

      // Should be exactly 20 (the limit)
      expect(allowedCount).toBe(20);

      // Remaining 5 should be ip_limited
      const deniedResults = data.filter(
        (r: { allowed: boolean }) => !r.allowed,
      );
      expect(deniedResults.length).toBe(5);
      expect(
        deniedResults.every(
          (r: { reason: string }) => r.reason === "ip_limited",
        ),
      ).toBe(true);

      // Verify exactly 20 events recorded for this IP
      const { rows: countRows } = await queryAsServiceRole(
        "SELECT COUNT(*) FROM rate_limit_events WHERE limiter_key = $1",
        [limiterKey],
      );
      expect(parseInt(countRows[0].count)).toBe(20);
    });

    it("two separate instances share the same count", async () => {
      const testIp = `203.0.113.${Math.floor(Math.random() * 200) + 10}`;
      const limiterKey = `ip:${testIp}`;

      // Instance 1: Use first 10 requests (concurrent)
      // Pool gives each query its own connection → simulates separate instances
      const batch1 = Array.from({ length: 10 }, (_, i) =>
        queryAsServiceRole("SELECT check_and_record_rate_limit($1, $2, $3, $4, $5, $6, $7)", [
          limiterKey,
          "ip_hourly",
          20,
          60 * 60 * 1000,
          testIp,
          `instance1-${i}@example.com`,
          "test-agent",
        ]),
      );
      const results1 = await Promise.all(batch1);
      const data1 = results1.map(
        (r: { rows: { check_and_record_rate_limit: { allowed: boolean } }[] }) =>
          r.rows[0].check_and_record_rate_limit,
      );
      expect(data1.every((r: { allowed: boolean }) => r.allowed)).toBe(true);

      // Instance 2: Use next 10 requests (concurrent)
      const batch2 = Array.from({ length: 10 }, (_, i) =>
        queryAsServiceRole("SELECT check_and_record_rate_limit($1, $2, $3, $4, $5, $6, $7)", [
          limiterKey,
          "ip_hourly",
          20,
          60 * 60 * 1000,
          testIp,
          `instance2-${i}@example.com`,
          "test-agent",
        ]),
      );
      const results2 = await Promise.all(batch2);
      const data2 = results2.map(
        (r: { rows: { check_and_record_rate_limit: { allowed: boolean } }[] }) =>
          r.rows[0].check_and_record_rate_limit,
      );
      expect(data2.every((r: { allowed: boolean }) => r.allowed)).toBe(true);

      // Instance 3: 21st request should be denied
      const result3 = await queryAsServiceRole(
        "SELECT check_and_record_rate_limit($1, $2, $3, $4, $5, $6, $7)",
        [
          limiterKey,
          "ip_hourly",
          20,
          60 * 60 * 1000,
          testIp,
          "instance3-denied@example.com",
          "test-agent",
        ],
      );
      const data3 = result3.rows[0].check_and_record_rate_limit;
      expect(data3.allowed).toBe(false);
      expect(data3.reason).toBe("ip_limited");
    });
  });

  describe("Window behavior", () => {
    it("respects rolling window (old events don't count)", async () => {
      const testEmail = `test-window-${Date.now()}@example.com`;
      const testIp = "203.0.113.200";
      const limiterKey = `email:${testEmail}`;

      // First request: should be allowed
      const result1 = await queryAsServiceRole(
        "SELECT check_and_record_rate_limit($1, $2, $3, $4, $5, $6, $7)",
        [
          limiterKey,
          "email_daily",
          1,
          24 * 60 * 60 * 1000,
          testIp,
          testEmail,
          "test-agent",
        ],
      );
      const data1 = result1.rows[0].check_and_record_rate_limit;
      expect(data1.allowed).toBe(true);

      // Second request: should be denied (email limit)
      const result2 = await queryAsServiceRole(
        "SELECT check_and_record_rate_limit($1, $2, $3, $4, $5, $6, $7)",
        [
          limiterKey,
          "email_daily",
          1,
          24 * 60 * 60 * 1000,
          testIp,
          testEmail,
          "test-agent",
        ],
      );
      const data2 = result2.rows[0].check_and_record_rate_limit;
      expect(data2.allowed).toBe(false);
      expect(data2.reason).toBe("email_limited");

      // Simulate window expiry by updating event timestamp to 25 hours ago
      await queryAsServiceRole(
        "UPDATE rate_limit_events SET event_time = NOW() - INTERVAL '25 hours' WHERE email = $1",
        [testEmail],
      );

      // Third request: should be allowed again (old event outside window)
      const result3 = await queryAsServiceRole(
        "SELECT check_and_record_rate_limit($1, $2, $3, $4, $5, $6, $7)",
        [
          limiterKey,
          "email_daily",
          1,
          24 * 60 * 60 * 1000,
          testIp,
          testEmail,
          "test-agent",
        ],
      );
      const data3 = result3.rows[0].check_and_record_rate_limit;
      expect(data3.allowed).toBe(true);
    });
  });
});
