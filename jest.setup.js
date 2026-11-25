import "@testing-library/jest-dom";

// BROWSERLESS_API_KEY stays unset in tests. A suite that needs a fake key
// sets it locally and must not print it.
delete process.env.BROWSERLESS_API_KEY;
delete process.env.BROWSERLESS_HOST;
