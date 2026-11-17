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
- The `specter` and `specter-write` skills, which name no tools yet.
