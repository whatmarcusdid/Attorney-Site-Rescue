/**
 * @jest-environment node
 */
jest.mock("server-only", () => ({}));

import { createAdminClient } from "@/lib/supabase/admin";
import { getServerEnv } from "@/lib/supabase/env";

const FAKE_URL = "https://example.supabase.co";
const FAKE_KEY = "test-service-role-key";

describe("Supabase admin client", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    global.fetch = jest.fn(() => {
      throw new Error("network was called");
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns null and throws when the server env is missing", () => {
    expect(getServerEnv()).toBeNull();
    expect(() => createAdminClient()).toThrow(/not configured/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("constructs a client from a fake URL and key without calling the network", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = FAKE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_KEY;

    const env = getServerEnv();
    expect(env).toEqual({
      supabaseUrl: FAKE_URL,
      supabaseServiceRoleKey: FAKE_KEY,
    });

    const client = createAdminClient();
    expect(client).toBeTruthy();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(env)).toContain(FAKE_URL);
  });
});
