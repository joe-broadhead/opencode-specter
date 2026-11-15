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
- `/specter-status`, the `/specter` dialog and the status RPC, with no upstream call.
- A REST client with retries for free reads only, honouring `Retry-After`, and never for a call that spends credits.
  Retrying is new to the family.
- The `specter` and `specter-write` skills, as placeholders.
