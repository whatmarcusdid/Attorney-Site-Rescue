# Attorney Site Rescue

Public repository for Attorney Site Rescue. This checkout is a buildable Next.js app with a placeholder home page, URL safety checks, and a Browserless client for a single home page. It does not run an audit, send email, or store scans.

## Requirements

- Node.js 22 or newer
- npm

## Setup

```bash
npm ci
cp .env.example .env
```

Leave `.env` empty unless you are doing a local Browserless check. `.env` is gitignored. `.env.example` has empty placeholders only.

`BROWSERLESS_API_KEY` is optional for `npm test`, `npm run lint`, and `npm run build`. Tests mock the browser client and do not call Browserless.

## Scripts

```bash
npm test
npm run lint
npm run build
npm run dev
```

`npm run dev` serves the placeholder page at `/`.

## Public repository

Do not commit API keys, captured HTML, scan results, or customer website addresses. Do not print a Browserless key or a WebSocket URL that contains one.

The copy log is `docs/SOURCE_MODULES.md`.
