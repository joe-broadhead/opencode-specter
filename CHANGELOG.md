# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.0.0 (unreleased)

Phase 4a of the plugin-family rebuild: the repository at its new name, on OpenCode 2.4.1, with the legacy Jelly paths
removed. The plugin-contract v0 adoption, accounts, releases and the full documentation come in phase 4b.

### Changed

- Renamed to `@we-the-rebel-alliance/specter-plugin`; the version restarts at `0.0.0`, so no install tag exists yet.
- Requires OpenCode `>=2.4.1 <2.5.0`, tested on `2.4.1` only. The host check derives both bounds from the one range.
- One namespace line for every `access` value: the access level is enforced by the permission rules and shown in
  status, not repeated in fixed context.
- The `specter` skill description is within the 300-character budget; `specter-write` keeps its 282-character one.

### Removed

- `docs/jelly.md`, the Jelly declaration tests and every Jelly-only paragraph from the README, docs and skills. The
  `jelly` and `sources` package.json keys and the hash-pinned kit copies stay until phase 4b replaces them.

### Fixed

- The host harness answers OpenCode 2.4.1's `server/discover` probe before the legacy `initialize`, and still proves
  the unauthenticated attempt carries no token.
- The source-contract dev pin names the `v0.3.0` commit, because phase 3 deleted the tag; `npm ci` resolves it.
