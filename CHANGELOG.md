# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A source install of this plugin sends nothing to Specter: the plugin registers Specter's MCP server and makes a vendor call only when the host reports this install as a tagged package (`…#vX.Y.Z`), read from `ctx.plugin.list` once its entry exists, or when a checkout is exactly at a release tag. A branch, a dev checkout or an untagged install answers `NOT_RELEASED` and sends nothing.

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
  a cursor, as events, with the saved search's id as the scope key. A read pages one window (a fixed
  `new_results_after`) by offset, so a burst drains at any limit without jamming; the next window starts two minutes
  before this one's first answer, so a company added behind the reader or visible late is listed next time. Each page
  after the first re-reads the five companies before it: when none of them is one the window listed, a shift may have
  skipped one, and the page answers one `window-truncated` gap. The cursor carries 40-bit hashes of the companies the
  recent windows listed (64, plus the 15 before the offset), each group kept only while the lookback can reach it, so
  no company is listed twice unless more than 64 are in play at once (worst case 976 characters, checked before any
  read). A call costs at most 30 credits. A cursor older than Specter's 60-day window answers `gap` once, with
  `more: true`, and restarts at the window's edge rather than at "now". A cut answer or an unrecognised record fails
  the page (`UNAVAILABLE`) with the cursor held, so no company is lost and the credits reported are what Specter
  returned.
- `specter_probe`, which names the team key's organisation from Specter's free credit-balance call.
- `npm run conformance` runs the source contract's conformance kit over recorded Specter answers and writes
  `reports/conformance-report.json` with `ok: true`.
- The `specter` and `specter-write` skills name the tools that now exist, and each says what it costs.
