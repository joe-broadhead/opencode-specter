# Changelog

## 0.0.0 (2026-11-25)

The first release, on OpenCode `>=2.4.1 <2.5.0` (tested on 2.4.1) and plugin-contract v0.

- One manifest (`capabilities` in `package.json`) and one `register` call wiring the seven methods through the agent
  tool, Code Mode and RPC: `status`, `probe`, `events_list`, `search_companies`, `get_company`, `list_saved_searches`
  and `saved_search_results`.
- Accounts through Specter's hosted MCP server, one server per alias (`specter`, `specter-<alias>`), with a separate
  `specter-team` integration for the team API key. The plugin's own tools are `accounts: none`.
- The `specter.saved` events source: companies added to one saved company search, with a cursor bound to plugin, source,
  account and scope, a 60-day gap, and a metered cost per company.
- Specter's own MCP tools passed through as `mcp:*`, classified `write` because their catalogue is not recorded yet.
- `get_company`, `saved_search_results` and `events_list` are reads with `effect: ask`: they spend the team's credits and
  ask before running at every access level.
- Generated docs from the manifest, two skills (`specter`, `specter-write`), unit, conformance, real 2.4.1 host and pack
  tests, and `plugin-kit check` in CI.
