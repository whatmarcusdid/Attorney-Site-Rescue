import "@testing-library/jest-dom";

// BROWSERLESS_API_KEY stays unset in tests. A suite that needs a fake key
// sets it locally and must not print it.
delete process.env.BROWSERLESS_API_KEY;
delete process.env.BROWSERLESS_HOST;
delete process.env.RESEND_API_KEY;
delete process.env.RESEND_WEBHOOK_SECRET;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
