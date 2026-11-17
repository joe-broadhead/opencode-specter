# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The repository scaffold, in the family's layout from opencode-github: the `jelly` declaration, the build to two
  self-contained bundles, the shared kit (r4.1) and `scripts/check.mjs` as the one check gate.
- Registration of Specter's hosted MCP server as `specter`, adopting a user's own entry at Specter's URL unchanged.
- The `specter` key integration for the team's API key, with one `key` method and no environment variable.
- The `access` option (`all`, the default; `ask-changes`; `read-only`) over three tool classes, `read`, `spend` and
  `write`, with tools not yet classified treated like changes; and the `requestTimeoutMs` option.
- `/specter-status`, the `/specter` dialog and the status RPC, which wait on no upstream call.
- A REST client with retries for free reads only, waiting the seconds Specter names in `X-RateLimit-Reset` on a 429,
  and never for a call that spends credits or after a 402. Retrying is new to the family.
- Specter's error object mapped to the plugin's codes: `KEY_REJECTED`, `OUT_OF_CREDITS`, `DAILY_CREDIT_CAP_REACHED`,
  and `UPSTREAM_ERROR` with Specter's error code and request ID, from Specter's public Errors page.
- The key check: one free `GET /organization/credits` per key, shown in `/specter-status` as accepted or rejected.
- What Specter calls cost, from Specter's public pages with their sources (`docs/costs.md`), the MCP allowance in
  status, and an honest `jelly.cost` line.
- Two separate sign-ins in Jelly: the MCP account, and the optional team key with a link to Specter's API Console.
- The plugin's own four Specter tools on the team key, from Specter's public API reference: `specter_search_companies`
  (Find company ID, free), `specter_get_company`, `specter_list_saved_searches` (free) and
  `specter_saved_search_results`, each stating its published credit cost.
- The `specter.saved` source under the source contract: the companies Specter added to one saved company search since
  a cursor, as events, with the saved search's id as the scope key. Its cursor holds a watermark, the page within the
  window and the ids of the page just listed, so a burst of additions drains page by page, the inclusive cutoff never
  repeats a company, and a cursor older than Specter's 60-day window answers `gap` once and restarts after it instead
  of sliding forward.
- `specter_probe`, which names the team key's organisation from Specter's free credit-balance call.
- `npm run conformance` runs the source contract's conformance kit over recorded Specter answers and writes
  `reports/conformance-report.json` with `ok: true`.
- The `specter` and `specter-write` skills name the tools that now exist, and each says what it costs.
