# Source modules

Donor repository: `whatmarcusdid/booked-n-busy-live`  
Donor commit: `816862ffd80d929421f7a3f8d3d9cbd14f3c69f0`

Blob SHAs are the Git blobs of that commit. Product names and fetch limits from the donor were not kept. Booking, calendar, admin, pre-call, leads, screenshots, performance, and design tokens were not copied. The email provider, the server-only database client, and the workflow config were ported later without a route, schema, or pipeline.

## Ported modules

| Destination | Donor path | Blob SHA | Adaptations |
| --- | --- | --- | --- |
| `lib/url-safety/bounds.ts` | `lib/url-safety/bounds.ts` | `bd432132708405c1b83dc556459800047a035758` | Replaced the donor fetch, performance, and page-count fields with the A1 home-page limits. Comment cites the A1 ticket. `sessionTimeoutMs` is 20,000 (15,000 ms budget plus a 5,000 ms close buffer). |
| `lib/url-safety/guard.ts` | `lib/url-safety/guard.ts` | `00a3bb405e185f844c11a8c834f2b1151c002271` | Behavior kept, including the Jest DNS short-circuit. The pre-flight comment now says the check runs before any Browserless call. |
| `lib/url-safety/index.ts` | `lib/url-safety/index.ts` | `0b953e90c4729a739782a68c0f9719a349981eeb` | Re-exported as-is. The bounds type it exports is the updated one. |
| `lib/url-safety/ip.ts` | `lib/url-safety/ip.ts` | `990b67ae6d38cf2d09deccd8ae56b3ec7c7c92bf` | Ported as-is. |
| `lib/url-safety/prohibited-content.ts` | `lib/url-safety/prohibited-content.ts` | `11934b4f29218d6102f4774d8d7c2559dc4ec5a9` | Match rules kept. Header comment rewritten so it is product-neutral. |
| `lib/url-safety/reasons.ts` | `lib/url-safety/reasons.ts` | `624ef83683ed6195fa1c6fac26aa87fc467ba526` | Ported as-is. Customer sentences were already generic. |
| `lib/identity.ts` | `lib/identity.ts` | `e51a2245901cef2e6d704b924704dfc1fd7d4c5f` | Structure only. `PRODUCT_NAME` is "Attorney Site Rescue". `SUPPORT_EMAIL` and `DEFAULT_FROM_EMAIL` are `audit@attorneysiterescue.com`. The crawler info URL stays the `example.com` placeholder. Donor host and brand values were not copied. |
| `lib/crawler/identity.ts` | `lib/crawler/identity.ts` | `5d941ddc7b11279758b512856354da154e90dec2` | Structure only. User-Agent is `AttorneySiteRescueBot/0.1-placeholder` plus the placeholder info URL and the product inbox. Product token is `attorneysiterescuebot`. |
| `lib/browserless/reasons.ts` | `lib/browserless/reasons.ts` | `55ba9673130872a070a6617db5fd6fa741d34173` | Kept reason codes, generic customer sentences, and `redactProviderSecrets`. Added a partial outcome, HTTP partial reasons, and redaction of the URL-encoded key. Partial results reuse the existing sentences. Later removed the unused donor helpers that mapped a home fetch onto unsupported and failed terminal states (`terminalStateForHomeFetchFailure`, `customerMessageForHomeFetchFailure`, `isTargetAccessDenied`). |
| `lib/browserless/user-agent.ts` | `lib/browserless/user-agent.ts` | `b171a90f1b159696a7a47601357e22171d29b6cb` | Ported as-is. It is the REST object helper only. The home-page client does not use REST `/content`. |
| `__tests__/lib/url-safety/guard.test.ts` | `__tests__/lib/url-safety/guard.test.ts` | `6c18b7395b217773803098e6aedde3c3e058db39` | Safety cases kept. Assertions updated for the A1 limits. Jest environment set to node. |
| `__tests__/lib/url-safety/prohibited-content.test.ts` | `__tests__/lib/url-safety/prohibited-content.test.ts` | `cfd7888fb4db845809c20e118bbee18f90270caa` | Cases kept. The ordinary-URL case title no longer uses the donor vertical wording. Jest environment set to node. |
| `lib/scan/retry.ts` | `lib/audit-workflow/retry.ts` | `f4e9766619ed43011bde04aefc88ecb0f0b4e827` | Classifier kept: one planned retry, only for 401/403 and transient timeout, network, provider, or 5xx. Safety rejections and other 4xx are not retried. Donor retry User-Agent replaced with the placeholder crawler identity plus a retry marker. Added `planHomeFetchRetryIfBudgetAllows`, which refuses a retry when the delay plus another connect and hard page-load would exceed the remaining first-results budget. Not called by `scanHomePage`. No workflow. |
| `lib/scan/budget.ts` | `lib/audit-workflow/budget.ts` | `818eff5f04fa1cc4b885f8250debd7d14128d23d` | Kept the $1.00 cost ceiling and the 15-minute wall clock, checked before spend, with charges idempotent on `operationKey`. Replaced the donor store with `ScanCostStore` and `createMemoryScanCostStore`. Dropped analytics events. Future cost category names and the narration rate helper are constants only. Not wired into `scanHomePage`. |
| `lib/scan/coverage.ts` | `lib/audit-workflow/coverage.ts` | `eb4a6c5e50659597f07e6d74b504a975239acb01` | Expected pages are home plus `about`, `services`, and `contact`. That category list is the `CATEGORY_PAGE_TYPES` constant from `lib/audit-workflow/discover-links.ts` (`cf0f5f3e49468116cdcc9865bbddf26b74178aab`); the rest of that file was not ported. Accepts an in-memory page list. A `notFound` page is absent, not an omission. Any other unread expected page is an omission and the terminal state is partial. Home not assessed is partial, never complete. No admin-review state. Header comment rewritten so it does not say home-service. |
| `__tests__/lib/scan/retry.test.ts` | `__tests__/lib/audit-workflow/retry-policy.test.ts` | `c21fca5bd8639fb5f265dcd3e1e24d1fdf15079d` | Classification cases only. Pipeline, mock-stage, and store cases were not ported. Added budget-aware cases. Jest environment set to node. The expected retry User-Agent uses the product inbox and the placeholder info URL. |
| `__tests__/lib/scan/coverage.test.ts` | `__tests__/lib/audit-workflow/coverage.test.ts` | `0953daf4cd108abd0bf5962ba3c70d175ae29beb` | Only the reduced-API cases were ported: partial on an omission, complete when every linked page was read, absent pages are not omissions, and an unassessed home page is partial. Needs Review and mock-hostname tests were not copied. |
| `lib/email/provider.ts` | `lib/email/provider.ts` | `8f6f5a35f3710947f2b645059930b8a7eaa58674` | Types kept. Added `ResendNotConfiguredError`. No store and no report copy. |
| `lib/email/resend.ts` | `lib/email/resend.ts` | `b6e2351d8a8f7fc60625f8684cd6de1c3650aebd` | Still calls `https://api.resend.com/emails` with `fetch` and an `Idempotency-Key`. Default From is `Attorney Site Rescue <audit@attorneysiterescue.com>`. `reply_to` is the product inbox. A missing API key throws `ResendNotConfiguredError` before `fetch` instead of returning `{ ok: false }`. The key is not logged. |
| `lib/email/webhook.ts` | `lib/email/webhook.ts` | `8e9edbc4cbdf830392c2d92852d66c4913ac0a26` | Signature helper only. No HTTP route. A missing secret or header still fails closed. |
| `__tests__/lib/email/resend.test.ts` | `__tests__/lib/email/resend.test.ts` | `dc211e0f0d8ffa39b22190cccf0bd145295440ae` | Rewritten for the product From address. Fetch is injected. Added the missing-key, error-string, and signature cases. Jest environment set to node. |
| `lib/supabase/admin.ts` | `lib/supabase/admin.ts` | `a82600c320f068b964573326f081c51d577752a6` | Service-role client kept. Added `import "server-only"`. Throws the same not-configured error when env is missing. No schema call. |
| `lib/supabase/env.ts` | `lib/env.ts` | `39d4f9107275167f62bc60b7a6fd6f66136d8a0b` | Only `getServerEnv`. The anon-key helper was not ported. Returns null when the URL or service-role key is missing. Added `import "server-only"`. |
| `lib/supabase/errors.ts` | `lib/supabase/errors.ts` | `6fa8d7f479853ff90a4c74be0e0318ef1b613253` | `describeDatabaseError` kept. Comment no longer names a framework logger. |

## Scaffold files adapted from donor structure

These are not full copies. Donor branding, the workflow plugin, and test fixtures for other services were left behind.

| Destination | Donor path | Blob SHA | Adaptations |
| --- | --- | --- | --- |
| `tsconfig.json` | `tsconfig.json` | `853c1173b99341c193298d5d2bbdc4396af5cd2d` | Kept `@/*` paths and the Next plugin. The `scripts` exclude stays off. The `workflow` plugin is restored beside the Next plugin. |
| `next.config.ts` | `next.config.ts` | `d5bd5dee77aee32ab22ff6bca8a0d138cfbbb1f2` | Empty Next config wrapped with `withWorkflow`. No other donor config. |
| `eslint.config.mjs` | `eslint.config.mjs` | `c03c2a9580ff42a53a461167f6cbc5df0f4963d1` | Same Next.js flat config, plus one override that allows `require` in `jest.config.js` (the `next/jest` config is CommonJS). |
| `jest.config.js` | `jest.config.js` | `f8cf12e47de2e032741899c729e81e8806b08b74` | Ported as-is (`next/jest`, `@/` mapper). |
| `.gitignore` | `.gitignore` | `91b172ca7d73d8acdc6f65e8aee1e006188572a0` | Ported as-is, including the `.env*` ignore with an exception for `.env.example`. |

`jest.setup.js` from the donor (`2ad162453b01a462588ba0edcafb98069b3e23d1`) was not copied. The donor file set fixtures for other services. This repo's setup only loads the Jest DOM matcher and clears `BROWSERLESS_API_KEY`, `BROWSERLESS_HOST`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## New in this repository

Not copied from the donor:

- `lib/browserless/home-scan.ts` — `scanHomePage` on the puppeteer-core WebSocket. One session, then close.
- `lib/browserless/index.ts` — public exports for the home-page client, bounds, reason helpers, and secret redaction.
- `__tests__/lib/url-safety/bounds.test.ts`
- `__tests__/lib/browserless/home-scan.test.ts`
- `__tests__/lib/browserless/reasons.test.ts`
- `__tests__/lib/scan/budget.test.ts` — no donor budget test file at this commit. Covers the time ceiling, the cost ceiling, idempotent charges, and a scan under both limits.
- `app/layout.tsx`, `app/page.tsx`, `app/globals.css` — placeholder page only.
- `app/workflows/foundation.ts` — one `"use workflow"` function and one `"use step"` that returns a typed not-implemented result. It does not start from a route and does not import the scan, budget, or email sender. `withWorkflow` generates `app/.well-known/workflow/` during build and test; that directory is gitignored.
- `__tests__/lib/supabase/admin.test.ts`
- `.env.example` — empty key placeholders. `RESEND_FROM_EMAIL` is the product inbox.
- `.github/workflows/ci.yml` — `npm ci`, `npm test`, `npm run lint`, `npm run build`. No secrets.
- `package.json` and the generated `package-lock.json`.

`package-lock.json` is the lockfile produced by `npm install` for the ranges in `package.json`. It is generated, not copied from the donor.
