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

### Removed since v0.0.1

- The `/specter-status` command and the TUI status view. `status` is now the contract's `specter_status` tool and the
  `specter` RPC method, so there is no app-specific command or TUI to keep.
- The status RPC id `specter.deals` and the tools RPC `specter.deals.tools`, including `describe`. The contract's one RPC
  id is `specter`, with one method per declared tool; `describe` is diagnostics only under contract §18.
- The key integration id `specter`. The team key is `specter-team`, so the per-alias MCP servers keep the names
  `specter` and `specter-<alias>`.
- The `NOT_RELEASED` source-install gate. Installs come only from release tags with the committed `dist/`; there is no
  source install left to gate.
- The old status surface: the free key check (accepted/rejected/unconfirmed), the MCP credit-use line, a user-configured
  server's adoption/conflict report, the visible/unknown MCP tool counts, shadowed-skill reporting, the permissions
  block and the untested-host warning. The contract's `statusAnswer` reports the manifest, the host range, each alias's
  MCP server state, the unguarded agents and one next step, and makes no upstream call; cost stays in the manifest.
- The bespoke MCP server adoption and conflict handling. The contract's `accounts` module registers one server per alias.
- The shared kit scripts (release, drift, copies, icons, forbidden, tested-hosts, capture-tools, native-manifest and
  changelog), the old app-specific package key, the `opencode` key and the top-level `sources` key, contract-1 code, the
  old `./tui` export and the TUI module. `plugin-kit` owns the shared checks, and `capabilities` is the one manifest.
