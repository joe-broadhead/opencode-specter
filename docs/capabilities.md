# Capabilities

Unofficial plugin. Not affiliated with Specter.

What the plugin declares in `capabilities` in `package.json`, and what each part means for a person and an agent. The
table is generated from the manifest: edit the manifest, never the section.

<!-- generated:capabilities -->
### Methods

| Method | Class | Accounts | Operations |
|---|---|---|---|
| `status` | read | none | — |
| `probe` | read | optional | — |
| `events_list` | read | optional | `searches.companies.results` |
| `search_companies` | read | none | `companies.resolve` |
| `get_company` | read | none | `companies.get` |
| `list_saved_searches` | read | none | `searches.list` |
| `saved_search_results` | read | none | `searches.companies.results` |
| `mcp:*` | write | none | — |

### Sources

| Source | Kind | Reads or output | Method | Cost |
|---|---|---|---|---|
| `specter.saved` | events | `x-specter/company` | `events_list` | metered |

### Actions

None.

### Bus events

None.
<!-- /generated:capabilities -->

## Methods

Every method is reachable as an agent tool, in Code Mode (`tools.specter.<method>`) and over RPC
(`POST /api/rpc/specter/<method>`), through one `register` call. `status`, `probe` and `events_list` are contract methods;
the rest are the plugin's own.

- `status` reads OpenCode's own state: the host range, each alias's MCP server state, and the agents whose rules no longer
  give the generated rules their effect. No upstream call.
- `probe` reads the free credit balance to confirm the team key, and answers the key's fingerprint
  (`specter:key:<hex>`), never a person or an organisation Specter does not report.
- `events_list` is the `specter.saved` feed. It spends credits.
- `search_companies` and `list_saved_searches` are free and come from Specter's Find-company-ID and saved-search list.
- `get_company` and `saved_search_results` spend 1 credit per result. `get_company`, `saved_search_results` and
  `events_list` carry `effect: ask`, so they ask before running at every access level.
- `mcp:*` is Specter's own MCP tools, passed through by OpenCode under the per-alias server names. Their catalogue is not
  recorded in this repository, so the manifest classifies all of them as `write`: a tool the plugin has not classified is
  treated like a change and is never widened to a read. Their permission actions are `<server>_<tool>`, one rule per alias.

Specter publishes no price per credit. Every answer states what it spent, in credits; the source's declared unit
(`company`, at the plugin's estimate per credit) is for a consumer's budget, never a Specter price.

## Sources

`specter.saved` is an events feed over one saved **company** search. It pages by cursor, holds the cursor back when
Specter's answer is cut or malformed, and answers one `gap` when the cursor's watermark is older than Specter's 60-day
window. It lists companies only: people, talent and other products are personal data and are not in the source. An event
is metadata (id, name); to read a company in full, use `get_company`.

## Actions

None. The plugin writes nothing to Specter: it reads companies and searches, and its own methods are all `read`.

## Bus events

None. The plugin makes no write and has no webhook, so it emits no `changed` nudge; apps poll through the RPC methods and
keep their own cursors.
