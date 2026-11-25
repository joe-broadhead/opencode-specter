# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.0]

The first release: the repository at its new name, on OpenCode 2.4.1, rebuilt on plugin-contract v0. It is ready for
`v0.0.0`, which the maintainer cuts after this tree lands.

### Added

- The `capabilities` manifest: the plugin `specter`, accounts through Specter's hosted MCP server, one events source
  (`specter.saved`, metered per company) and the seven methods, including Specter's pass-through MCP tools as `mcp:*`.
- Accounts: several aliases at once, each a separate `specter`/`specter-<alias>` MCP sign-in, plus the separate
  `specter-team` integration for the team's API key. The plugin's own tools are `accounts: none` and always use the team
  key.
- Every method on every door through one `register` call: the agent tool, Code Mode and RPC.
- `status` from the contract's status builder, `probe` over the team key's fingerprint, and `events_list` over the
  saved-search feed with a cursor bound to plugin, source, account and scope.
- The saved-search feed keeps a compatible cursor for 60 days, answers one `gap` when Specter's window has passed, and
  holds its cursor when a page is cut or malformed.
- Unit, conformance (two synthetic accounts), real 2.4.1 host and pack suites; `plugin-kit check` in CI.

### Changed

- The package is `@we-the-rebel-alliance/specter-plugin` and the plugin id, tool namespace and RPC id are `specter`.
- `get_company`, `saved_search_results` and `events_list` are reads with `effect: ask`: they spend the team's credits and
  ask before running at every access level.
- The copied kit is deleted; `plugin-kit` runs conformance, generated docs, forbidden patterns and the doc file set, and
  `scripts/` holds only this plugin's build and check.

### Removed

- The old tools RPC, the manual permission defaults, the manual status RPC and TUI, the contract-1 code, the old
  family-only package keys (`sources`, `opencode` and the app block), and the copied release, drift, copies, icons,
  forbidden, tested-hosts, capture-tools, native-manifest and changelog scripts.
