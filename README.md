# Specter plugin for OpenCode

Connects OpenCode to [Specter](https://tryspecter.com)'s deal data. Specter's own hosted MCP server is registered once per
account alias and holds each person's sign-in; the plugin's own tools use the team's Specter API key for company lookups,
saved searches and the `specter.saved` feed of companies added to a saved search.

Unofficial; not affiliated with Specter. Specter is a trademark of its owner, and this plugin is not endorsed by them.

## Requirements

- OpenCode `>=2.4.1 <2.5.0`, tested on `2.4.1`. Outside that range the plugin refuses to load unless the
  `allowUntestedHost` option is set.
- A Specter seat for the per-person MCP sign-in.
- For the plugin's own tools and the feed, API access for the team. The team's one API key is in Specter's
  [API Console](https://app.tryspecter.com/settings/api-console); API use is metered in credits.
- Node.js 22.19 or later, and Bun 1.4, only to work on the plugin.

## Install

The first release is `v0.0.0`, cut by the maintainer when this tree lands. There is no install from a checkout, and no
earlier tag: until `v0.0.0` exists the line below has nothing to fetch.

```sh
opencode plugin add github:we-the-rebel-alliance/specter-plugin#v0.0.0
```

The same entry in `opencode.json`:

```json
{ "plugins": ["github:we-the-rebel-alliance/specter-plugin#v0.0.0"] }
```

## Sign in

Specter has two separate sign-ins:

| Where | What it signs in |
| --- | --- |
| `/mcps` | Specter's own MCP server, one per account alias (`specter` for `default`, `specter-<alias>` otherwise), with OpenCode's OAuth. Yours alone. |
| `/connect` → **Specter team API key** | The plugin's own tools and the `specter.saved` feed, with the team's API key. One key for the whole team. |

The integration named `specter-team` is the team key. It is not an account: the plugin's own tools are
`accounts: none` and always use it. Every account alias is a separate person's MCP sign-in.

The team key is sent only to Specter's REST API in the `X-API-Key` header, and never appears in a status line, a log line
or a result. Everyone who uses it spends from one credit pool and one rate limit, and Specter cannot tell who made a call.

Several accounts:

```json
{
  "plugins": [
    {
      "package": "github:we-the-rebel-alliance/specter-plugin#v0.0.0",
      "options": { "accounts": { "work": {}, "personal": {} } }
    }
  ]
}
```

Each alias signs in separately in `/mcps` (`specter-work`, `specter-personal`). A call that takes an account names it;
with more than one alias, leaving it out is `ACCOUNT_REQUIRED`, whose next step lists the aliases.

## Use

The `specter` skill covers the reads; `specter-write` covers the calls that spend credits. Specter's own MCP tools appear
under the same `specter` namespace. The plugin's own tools are:

| Tool | What it does | Cost |
| --- | --- | --- |
| `specter_status` | The plugin's state, its host range and each alias. | Free |
| `specter_probe` | The team key's owner (its fingerprint), and nothing it reads. | Free |
| `specter_events_list` | The `specter.saved` feed: companies added to one saved company search since a cursor. | 1 credit per company returned |
| `specter_search_companies` | Resolve 1 to 50 domains to Specter company IDs. | Free |
| `specter_get_company` | One company's profile by its Specter ID. | 1 credit per result returned |
| `specter_list_saved_searches` | The saved company searches shared with the API, as `{ id, label }`. | Free |
| `specter_saved_search_results` | One saved company search's matches, a page at a time. | 1 credit per result returned |

Specter's own MCP tools are passed through, but their catalogue is not recorded yet, so the manifest declares `mcp:*` as
a change rather than as a read: a tool the plugin has not classified is treated like a change, never widened to a read.

`specter.saved` lists the companies Specter added to one saved company search since a cursor, as events for a collector
or automation. It reads with the team key and spends one credit per company Specter returns. The scope is the saved
search's id; companies only, metadata only. A cursor older than Specter's 60-day window answers one `gap` and restarts at
the earliest readable line. An event's `occurred_at` is when the read observed the company, because Specter returns no
"added to the search" time.

Specter publishes no price per credit. The plugin reports what a call spent, in credits; the source's manifest cost is an
estimate for a consumer's budget, never a Specter price.

## Access

The `access` option generates default rules for every agent:

| `access` | Free reads | Calls that may spend credits, and Specter's MCP tools |
| --- | --- | --- |
| `all` (default) | run | run |
| `ask-changes` | run | ask |
| `read-only` | run | denied |

`get_company`, `saved_search_results` and `events_list` spend credits, so the manifest gives them `effect: ask`: they ask
before running at every access level, including `all`. A refusal is `PERMISSION_DENIED`. The last matching rule wins, so
an agent's own stricter rules and your saved approvals still win.

## Capabilities

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

## Errors

Every failure reads `CODE: What happened. Next step: What to do.`

<!-- generated:errors -->
| Code | Meaning |
|---|---|
| `NEEDS_SIGN_IN` | the account is not signed in |
| `SCOPE_MISSING` | the call needs a scope the person has not confirmed |
| `ACCOUNT_REQUIRED` | the plugin serves several accounts and the call names none |
| `ACCOUNT_UNKNOWN` | the call names an alias the plugin does not serve |
| `ACCOUNT_MISMATCH` | the item belongs to another account |
| `CURSOR_INVALID` | the cursor is malformed, or belongs to another source, account or scope |
| `CURSOR_EXPIRED` | the provider no longer keeps the history the cursor names |
| `RATE_LIMITED` | the provider asked the plugin to slow down |
| `BUDGET_EXCEEDED` | the read would cost more than the person allows |
| `SOURCE_DISABLED` | the person turned this source or action off |
| `TOO_LARGE` | the answer is larger than the source's maxBytes |
| `INPUT_INVALID` | the input does not match the method's schema |
| `SOURCE_UNKNOWN` | the plugin declares no such source |
| `SCHEMA_VIOLATION` | an answer does not keep the contract's shape |
| `PERMISSION_DENIED` | the person's grant does not cover the call |
| `PLAN_INVALID` | the plan is missing, or belongs to another method |
| `PLAN_USED` | the plan was already used by an earlier commit |
| `GRANT_INVALID` | the action grant did not verify, or was already spent |
| `HOST_UNTESTED` | OpenCode is outside the plugin's tested range |
| `OPTIONS_INVALID` | the plugin's options do not match their schema |
| `UNAVAILABLE` | the provider could not be reached |
<!-- /generated:errors -->

## Uninstall

1. Sign out of each Specter server in `/mcps` (`specter`, or `specter-<alias>` for each account).
2. Remove the team key in `/connect` → **Specter team API key**.
3. Remove the plugin entry from `opencode.json`, then reload OpenCode.
4. The plugin keeps no data of its own.

## Links

- [Accounts](docs/accounts.md)
- [Configuration](docs/configuration.md)
- [Capabilities](docs/capabilities.md)
- [Automations](docs/automations.md)
- [Architecture](docs/architecture.md)
- [Security](docs/security.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)

MIT licence; see [LICENSE](LICENSE).
