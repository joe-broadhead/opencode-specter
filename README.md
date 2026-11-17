# Specter for OpenCode

Connects OpenCode to [Specter](https://tryspecter.com)'s deal data, so your agents can find a company and read its
profile and signals, through Specter's hosted MCP server and, in a later release, the plugin's own tools on your team's
Specter API key.

Unofficial; not affiliated with Specter.

Specter is a trademark of its owner; this unofficial plugin is not endorsed by them.

> **Not yet released.** This is v0.0.1 before its first release: the plugin registers Specter's hosted MCP server,
> declares the Specter key sign-in, inserts its default rules and shows its status, and has no tools of its own yet.
> Its only call to Specter's REST API is the free key check. The tool table fills from a live capture of Specter's
> server in a later step.

## Requirements

- OpenCode `>=2.2.3 <2.4.0`, tested on 2.2.3, 2.2.4, 2.2.5, 2.2.6, 2.2.7 and 2.3.0. A later 2.2 or 2.3 release loads
  too, and the status marks it untested. Outside `>=2.2.3 <2.4.0` the plugin does not load, unless you set
  [`allowUntestedHost`](docs/configuration.md#options).
- macOS or Linux.
- A Specter seat. Specter's MCP server signs each person in on their own, and is part of Specter's seat plan.
- For the plugin's own tools, when they arrive: API access for your team. Specter's API needs at least one paid seat,
  and the team's one API key lives in Specter's [API Console](https://app.tryspecter.com/settings/api-console). With
  no key there yet, choose **Request API Access** in the console; Specter says it reviews requests within one business
  day. API use is metered in credits, priced on request; a trial of 200 free credits can be requested in the same
  console. Sources: Specter's [Authentication](https://api.tryspecter.com/api-ref/auth.md) and
  [Plans & Pricing](https://api.tryspecter.com/api-ref/plans.md) pages. Not yet confirmed: whether a team with a seat
  is approved without a separate API contract.

## Install

```sh
opencode plugin add github:joe-broadhead/opencode-specter#v0.0.1
```

Run `opencode reload`, or restart OpenCode. Then run `/specter-status` in a session.

Or add the plugin to `opencode.json` instead, with the same spec:

```json
{ "plugins": [{ "package": "github:joe-broadhead/opencode-specter#v0.0.1" }] }
```

The install takes the GitHub release tag. Its commit carries the built `dist/`, so the install runs no build. Each
release has its own tag, and a Git install does not update by itself: to move to a newer release, remove the old entry
with `opencode plugin remove`, then add the new tag.

## Sign in

Specter has two sign-ins, and they are separate:

| Entry | What it is | What it signs in |
| --- | --- | --- |
| The `specter` server (in `/mcps`) | Specter's hosted MCP server, `https://mcp.tryspecter.com/mcp`, with OpenCode's own OAuth sign-in. Yours alone. | Specter's own MCP tools. |
| **Specter** (in `/connect`) | The plugin's key sign-in: paste the team's Specter API key. | The plugin's own tools on Specter's REST API, and the `specter.saved` source. |

The key is the team's: everyone who uses it spends from one credit pool and one rate limit, and Specter cannot tell
who made a call. OpenCode stores the key; the plugin reads it when a call needs it, sends it only to Specter's REST API
in the `X-API-Key` header, and never shows it in an error, a status line, a log line or a result. There is no
environment variable for the key.

Specter's MCP server publishes the sign-in metadata OpenCode uses: OAuth with PKCE, and both ways for OpenCode to
identify itself (a client ID metadata document, or dynamic client registration). Specter documents no admin step for
it ([How Specter MCP Authentication Works](https://intercom.help/specter-labs/en/articles/14495365-how-specter-mcp-authentication-works));
your company's single sign-on may still ask an admin to approve a new app. The plugin's tests sign in against a fake
built from that metadata. Not yet confirmed: a sign-in with a live Specter account.

Each person gets 100 MCP tool calls a day. Past that, a call spends the team's API credits only if a Specter workspace
admin turned on **Use API credits for MCP requests** in Specter's [MCP settings](https://app.tryspecter.com/settings/mcp);
otherwise Specter declines it until the next day. See [What Specter calls cost](docs/costs.md).

## Use

Ask for what you need. The `specter` skill tells the model how to use Specter's tools; `specter-write` covers calls that
spend credits or change Specter data.

The plugin's own tools read Specter's public REST API with the team key, and each says what it costs:

| Tool | What it does | Cost |
| --- | --- | --- |
| `specter_search_companies` | Resolve 1 to 50 domains to Specter company IDs (Find company ID). | Free |
| `specter_get_company` | One company's profile by its Specter ID. | 1 credit per result returned |
| `specter_list_saved_searches` | The saved searches shared with the API, as `{ id, label }`. | Free |
| `specter_saved_search_results` | One saved company search's matches, page by page, optionally only what was added since a moment. | 1 credit per result returned |

Specter's own MCP tools appear under the same `specter_` prefix once you sign in. The plugin does not classify them
until it has captured the live server's tool list, so each one is treated like a change (see
[Permissions](#permissions)).

## The saved-search source

`specter.saved` is this plugin's one source under the source contract: the companies Specter **added to one saved
company search**, as events, so Memory's collector or a script can follow a search without asking for the whole list
again. It reads with the team key and costs one credit per company Specter returns.

- **Scope.** The thing a person confirms is the saved search's id (`scope.search`), from `specter_list_saved_searches`.
  The search must be shared to the API. People, talent and other products are not in this source: those are data about
  individuals.
- **Companies only, metadata only.** Each event carries the company's Specter id (`company:<id>`), its name, and the
  read that first listed it. No profile prose, no contact details, no link (Specter's reference publishes no company-page
  address).
- **When it happened.** Specter's records carry no "added to the search" time, so an event's `occurred_at` is when the
  read that first listed the company was answered, taken from Specter's own `Date` header. It is not the company's
  `last_updated`, which says nothing about when the search matched it.
- **Cursors.** A cursor holds the window's watermark (`new_results_after`), the page within that window, and a 16-hex
  hash of each company id the last read saw. Its worst case is 922 characters, inside the contract's 1,024, and that
  budget is checked before a single credit is spent. Paging is by offset over a set that can change, so the watermark
  is fixed until the window ends: a burst of companies added at one instant drains page by page and never jams.
- **Late arrivals, shifts and repeats.** Offset paging over a changing set has no stable order, so the plugin does not
  pretend otherwise: after the first page it re-reads the previous page's last five companies (and drops them by hash),
  and the next window starts two minutes *before* this window's first answer, not at its last one. That is what finds a
  company added while the reader paged, one whose match changed, or one that became visible late. Both re-reads are
  charged, and companies they repeat are listed once because the cursor drops them by id — a company older than the
  cursor's 30 carried hashes can repeat, with the same `external_id`. Specter's inclusive cutoff ("on or after") is
  covered the same way. The two minutes are an assumption until a live check measures the lag between an addition and
  its visibility.
- **60 days, then a gap.** Specter tracks additions for 60 days. A cursor older than that answers `gap` with reason
  `expired` once, with `more: true` so the consumer reads on at once, and its cursor restarts at the earliest line
  Specter can still serve — the window's edge, not "now" — so the sixty days Specter still holds are listed rather than
  skipped. When Specter itself answers 422 for a cutoff, the same line is used unless the cursor is already at the edge,
  where it restarts at "now" because nothing earlier is known to be readable.
- **A cut answer is a failure.** A body cut at the read's inline limit, or a company record the plugin does not
  recognise, fails the whole page with `UNAVAILABLE` and holds the cursor: no company is dropped silently, and the
  credits reported are always what Specter returned.

The contract's own documentation is in the [source contract](https://github.com/we-the-rebel-alliance/source-contract).

## Permissions

The plugin puts a block of default rules into each agent right after its base `* * allow` rule. The `access` option
generates the block from three classes of tool:

| Class | What it is | `all` (default) | `ask-changes` | `read-only` |
| --- | --- | --- | --- | --- |
| `read` | Changes nothing. Free, except a source's read, which Specter bills per company. | allow | allow | allow |
| `spend` | Costs Specter credits from the team's pool. | allow | ask | deny |
| `write` | Changes Specter data, such as a list. | allow | ask | deny |
| not yet classified | Every tool the plugin does not know. | allow | ask | deny |

The last matching rule wins, so an agent's own stricter rules, your `permissions` and saved approvals still win.
`/specter-status` names any agent that misses the block (an agent defined only in your config), and shows the block to
paste first in that agent's own `permissions`.

## Configure

The plugin works without options. The [configuration guide](docs/configuration.md) covers `access`,
`requestTimeoutMs` and `allowUntestedHost`.

## Organisation rollout

An organisation can install the plugin for every user through OpenCode's system config:
`/Library/Application Support/opencode/opencode.json` on macOS, `/etc/opencode/opencode.json` on Linux. Each member
then signs in to the `specter` server, and someone with the team key pastes it in `/connect` → **Specter**. Never put
the key in `opencode.json`.

To rotate the team key, for example after it leaked, email api-support@tryspecter.com, as Specter's
[Authentication](https://api.tryspecter.com/api-ref/auth.md) page says. Then everyone pastes the new key in `/connect` →
**Specter**. Until they do, the old key is refused. `/specter-status` asks Specter about a key the first time it sees
it, and again once the last answer is more than 10 minutes old, in the background: a few seconds after such a
`/specter-status`, it shows the old key as rejected by Specter, with no restart. While that check runs, it shows the
key as not checked. The plugin's own tools, when they arrive, fail with `KEY_REJECTED` on the old key at once.

## Troubleshooting

Run `/specter-status` first. It always ends with one next step, `Nothing to do.` when everything is ready. Its
connection states:

| Connection | What to do |
| --- | --- |
| `sign-in required` | Open `/mcps`, choose `specter` and sign in. |
| `connecting` | Wait a few seconds and run `/specter-status` again. |
| `failed` | Check your network connection, then reconnect `specter` in `/mcps`. |
| `disabled` | Turn the `specter` server back on in `/mcps`. |
| `not configured` | Restart OpenCode; check that no other plugin removes the server named `specter`. |
| `conflict` | Your config defines its own server named `specter` at another address. Point it at Specter's address, or remove it. |

The plugin's errors start with a code and end with one next step:

| Code | When | Next step |
| --- | --- | --- |
| `HOST_UNTESTED` | Start-up, outside `>=2.2.3 <2.4.0` | Update OpenCode or the plugin, or set `allowUntestedHost`. |
| `OPTIONS_INVALID` | Start-up: an option is unknown or has a wrong value | Fix that option in `opencode.json`; the message names it. |
| `SKILLS_INVALID` | Start-up: a shipped skill file is missing or malformed | Reinstall the plugin. |
| `RULES_NOT_ADDED` | Status: the default rules could not be added | Restart OpenCode. |
| `SERVER_NOT_REGISTERED` | Status: the `specter` server or its tools could not be registered | Restart OpenCode. |
| `INTEGRATION_NOT_REGISTERED` | Status: the **Specter** key sign-in could not be added to `/connect` | Restart OpenCode. |
| `KEY_UNAVAILABLE` | Log warning: OpenCode could not read the key | Run `/connect`, choose **Specter** and paste the key again. |
| `STATUS_UNAVAILABLE` | Status | Try again in a few seconds; if it persists, restart OpenCode. |
| `AUTH_REQUIRED` | A tool needs the team key and none is connected | Run `/connect`, choose **Specter** and paste the team API key. |
| `INPUT_INVALID` | A tool's input does not fit its schema | Fix the input, then call the tool again. |
| `API_PATH_INVALID` | A request path could leave Specter's REST API | Pass a relative path. |
| `API_UNREACHABLE` | Specter's REST API could not be reached | Check your network, then try again. |
| `API_TIMEOUT` | Specter did not answer within `requestTimeoutMs` | Try again; raise `requestTimeoutMs` if it keeps happening. |
| `API_REDIRECTED` | Specter redirected a change, which is never followed | Check the path, then call the tool again. |
| `API_REDIRECT_LOOP` | Specter redirected more than 5 times | Try again later. |
| `API_REDIRECT_INSECURE` | Specter redirected to a non-HTTPS address | Try again later. |
| `API_REDIRECT_OFF_HOST` | Specter redirected a read outside its REST API | Try again later. |
| `KEY_REJECTED` | Specter refused the team API key (401, or a 403 that refuses the key itself) | Run `/connect`, choose **Specter** and paste a current key from Specter's [API Console](https://app.tryspecter.com/settings/api-console). |
| `OUT_OF_CREDITS` | Specter answered 402: the team's credit budget for the period is spent | Wait for the period to renew, or ask Specter for more credits. Calls that spend credits fail until then. |
| `DAILY_CREDIT_CAP_REACHED` | Specter answered 402: the organisation's daily credit limit is reached | Wait until 00:00 UTC (the message gives the wait when Specter sends it); an admin can ask Specter to change the limit. |
| `UPSTREAM_ERROR` | Specter answered with another error status | The one in the message: for 403, the team's plan does not include that endpoint; for 429, wait the seconds it names; for 5xx on a call that spends credits, check before you call it again. The message carries Specter's request ID for a report to api-support@tryspecter.com. |

A script's errors from the tools RPC have their own codes, listed in [Scripting](docs/scripting.md#errors).

## Uninstall

1. Sign out of the `specter` server: `opencode mcp logout specter`, while the plugin is installed.
2. Remove the key: `opencode auth logout Specter`.
3. Remove the plugin with `opencode plugin remove github:joe-broadhead/opencode-specter#v0.0.1`, then
   `opencode reload`.
4. The plugin keeps no data of its own. Remove the default rules you copied into agents' own `permissions`.

## Known limits

- **Not yet confirmed live.** Every endpoint, parameter, record shape and credit rate the plugin's own tools and the
  source use comes from Specter's public API reference, recorded on 17 November 2026. No key has been used against
  Specter yet, so the first live call may find a difference; `/specter-status` and the error's next step say what to do.
- **Specter's MCP tools are not classified.** They appear in the namespace once you sign in, but a capture of the live
  server's tool list has not run, so each one is treated like a change.
- **The source is companies only.** People, talent, investor-interest and other products are data about individuals, so
  `specter.saved` does not read them. Use the tools for a company search, and nothing here for a people search.
- **The source lists what Specter returns, in Specter's order.** The order of results under `new_results_after` is not
  documented, and the records carry no addition time, so an event's place in time is the read that first listed it.
- **The key is one team's.** Specter issues one API key per team; rotating it is the team admin's job, through
  `api-support@tryspecter.com` (see [SECURITY.md](SECURITY.md)).
- **The source's read is a read.** It changes nothing, so the `access` option does not gate it, even though Specter
  charges one credit per company: a consumer's own consent and budget decide whether it runs, and the `specter` skill
  says never to call it to answer a question. The direct `specter_saved_search_results` and `specter_get_company` calls
  are `spend`, and `access` gates those as changes.
- **Repeats and their credits.** The lookback and the page overlap re-read companies Specter still returns, so a poll
  can cost a few more credits than the companies it lists. `cost` always reports what Specter returned.
- **One team key.** Specter issues one API key per team, so it cannot be scoped down per person, and every call with
  it spends from one credit pool and one rate limit of 15 requests a second. Specter's error codes also mention
  per-member keys; the plugin has not been tried with one.
- **Credit costs come from Specter's docs.** [What Specter calls cost](docs/costs.md) lists Specter's published rates
  for each MCP tool and REST call, with their sources. They are not yet confirmed against live calls. A result
  reports what it spent only if Specter's response says so; the plugin never estimates.
- **Error meanings come from Specter's docs.** The codes for a refused key, spent credits, the daily credit limit and
  the rest follow Specter's [Errors](https://api.tryspecter.com/api-ref/errors.md) page, not yet confirmed against live
  responses.
- **Retries.** A free read is retried on a rate limit, waiting the seconds Specter names in `X-RateLimit-Reset`, or on
  a server error; a call that may spend credits is never retried, and nothing is retried after a 402.
- **No browser automation.** Specter's terms forbid automated access outside its API; the plugin never drives the
  website.
- **Specter content is not trusted.** A result can carry instructions; the skills tell the model not to follow them.
- **Hosts and platforms.** Tested on OpenCode 2.2.3, 2.2.4, 2.2.5, 2.2.6, 2.2.7 and 2.3.0, on macOS or Linux.

## Links

- [Configuration](docs/configuration.md)
- [Architecture](docs/architecture.md)
- [Scripting](docs/scripting.md)
- [In Jelly](docs/jelly.md)
- [What Specter calls cost](docs/costs.md)
- [Specter's MCP tools, a draft classification](docs/tool-classes.md)
- [Security](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)

MIT licence; see [LICENSE](LICENSE).
