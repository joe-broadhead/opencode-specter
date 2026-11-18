# Architecture

How the plugin is built, for contributors. It follows opencode-github: one namespace, two tool families, a hosted MCP
server over OAuth and the plugin's own REST tools, all under the `specter_` prefix.

## Parts

| Module | What it does |
| --- | --- |
| `src/index.ts`, `src/plugin.ts` | The server part: `Plugin.define` with the id `specter.deals`, set up in opencode-github's order. |
| `src/constants.ts` | Ids, the MCP endpoint, the REST base, the host range, `TESTED_HOSTS` and the error codes. No imports: `scripts/check.mjs` loads it. |
| `src/options.ts` | Strict option parsing with zod; an unknown key is `OPTIONS_INVALID`. |
| `src/permissions.ts` | The default rules from the three tool classes, inserted after each agent's base allow. |
| `src/specter-tools.ts` | Specter's MCP tool table and classes. Empty until the live capture. |
| `src/tool-spec.ts` | A tool spec's shape, and how one becomes the model's tool and the scripts' method (opencode-gws's pattern). |
| `src/read-tools.ts` | The plugin's four REST tools on the team key: `search_companies`, `get_company`, `list_saved_searches` and `saved_search_results`, each with its endpoint, its class and its published credit cost. |
| `src/source/saved.ts` | `specter.saved`: the saved company search's net-new companies as events, its cursor, its gap and its probe. Pure, over an injected read. |
| `src/source/index.ts` | The source as the plugin offers it: `events_list` and `probe` in the namespace and over the tools RPC, with the actions and operations they assert. |
| `src/tools.ts` | The namespace description, `OWN_TOOLS`, `isServerTool`, and the count of the server's tools. |
| `src/credential.ts` | The `specter` key integration, and reading the key at call time. |
| `src/key-check.ts` | The key check: one free `GET /organization/credits` per key, again after 10 minutes, read as Specter's public docs describe the answers; any 403 but `NOT_PERMITTED` or a key refusal is "not confirmed". |
| `src/api/request.ts` | The REST client (opencode-github's structure): the four tools and the source read through it. |
| `src/api/specter-error.ts` | Specter's error object, mapped to the plugin's codes, from Specter's public Errors page. |
| `src/costs.ts` | Specter's published costs, with their sources (`docs/costs.md`). Decides no permission. |
| `src/tools-rpc.ts` | The tools RPC's plugin value and method table, for the source contract's `tools-rpc`. |
| `src/rpc.ts`, `src/status.ts` | The status contract, `/specter-status` and the status RPC. |
| `src/tui/index.tsx` | The `/specter` status dialog. |
| `src/skills.ts`, `src/redact.ts`, `src/host-version.ts`, `src/version.ts`, `src/errors.ts` | Skills, redaction, the host check, the version and the error class. |

## Setup order

Options, the host check, then each registration, kept for cleanup in reverse: the default rules; the namespace and the
plugin's own tools; the MCP server; the key integration; status; the tools RPC; the skills. Every transform is
synchronous and never throws: a failure is kept, and status shows it with its next step.

## MCP registration

The plugin registers `specter` at Specter's endpoint with the host's defaults. If your config already has a server named
`specter`, the plugin reads only its `type`, its `url` and whether `oauth` is `false`, never its `headers`: at
Specter's URL it is adopted unchanged; anywhere else it is a conflict, left alone, and the tools RPC does not call it.

## The team key

The plugin declares its own `specter` integration with one `key` method, as OpenCode 2.2.3's built-in Tavily plugin
declares Tavily's, and deliberately no `env` method. At call time it reads `connection.active("specter")`, then
`connection.resolve(connection)`, and uses the value only when its `type` is `"key"`. The key is sent only to Specter's
REST origin, under its base path, in `X-API-Key`.

## REST client

Redirects are handled by hand: a change never follows one, and a read follows one only within the REST base. Bodies are
read up to 10 MB and results capped at 100 KB inline. A `read` (free) call is retried on 429 and 5xx with backoff and
jitter: a 429 waits the seconds in `X-RateLimit-Reset`, a 5xx waits `Retry-After` when Specter names one; a `spend` call is never retried, because it may already have been charged, and a
`write` call is not retried because it is not known to be idempotent. 400, 401, 402, 403, 404 and 422 are never
retried, as Specter's [Errors](https://api.tryspecter.com/api-ref/errors.md) page says. `src/api/specter-error.ts` maps
Specter's `{ errorCode, message }` to the plugin's codes, naming `errorCode` and `X-Request-ID` but never Specter's
message. These retries are new to the family.

## Status, RPC and the TUI view

`/specter-status`, the `/specter` dialog and the status RPC render one status model. Status waits on no upstream call; with a key connected it starts the free key check in the background.

## Tools RPC

`specter.deals.tools`, the source contract's transport with Specter's plugin value. Scripts call classified tools
with no model, as a session and its agent, under a prior allow. The table is the MCP tools the plugin has classified
(none yet), the four REST tools, and the source's `events_list` and `probe`.

## The saved-search source

`specter.saved` is declared in `package.json`'s `sources`, so a consumer reads it from the installed package, never over
RPC. `events_list` reads `GET /searches/companies/{searchId}/results` with the window's cutoff — and, after the first
page, the five companies before the offset again, which is how a shifted offset is recovered or, when it cannot be,
reported as one `window-truncated` gap — and asserts `specter_events_list` and `specter.read` on
`<account>:searches.companies.results`; `probe` asks the free `GET /organization/credits` and asserts `specter_probe`
alone. The two operations a source read asserts on a resource are allowed at every access by two rules at the end of
the default block, so a read the host allows is not asked about again underneath. The cursor holds the window's
cutoff, offset and next cutoff, and packed 40-bit hashes of the companies the recent windows listed, in groups that
expire with the lookback (`src/source/saved.ts` explains why each part is there); its worst case is 976 characters
against the contract's 1,024, and that budget is checked before a read so no credit is spent on a page whose cursor
could not be issued. `npm run conformance` runs the source contract's kit over recorded Specter answers and writes
`reports/conformance-report.json`; the report must say
`ok: true`. No module in this plugin has called Specter.
