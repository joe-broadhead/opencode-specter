# Specter plugin for OpenCode

Connects OpenCode to [Specter](https://tryspecter.com)'s deal data: Specter's hosted MCP tools, signed in per person,
and the plugin's own tools on the team's Specter API key for company profiles, saved searches and the `specter.saved`
feed.

Unofficial; not affiliated with Specter. Specter is a trademark of its owner, and this plugin is not endorsed by them.

This is `0.0.0`, the first release line. The plugin-contract adoption, accounts and the full documentation come next;
until a release tag is cut, a source checkout sends nothing to Specter.

## Requirements

- OpenCode `>=2.4.1 <2.5.0`, tested on 2.4.1. Outside that range the plugin refuses to load unless the
  `allowUntestedHost` option is set.
- macOS or Linux.
- A Specter seat for the per-person MCP sign-in.
- For the plugin's own tools, API access for the team. The team's one API key is in Specter's
  [API Console](https://app.tryspecter.com/settings/api-console); API use is metered in credits.

## Install

```sh
opencode plugin add github:we-the-rebel-alliance/specter-plugin#v0.0.0
```

The same entry in `opencode.json`:

```json
{ "plugins": [{ "package": "github:we-the-rebel-alliance/specter-plugin#v0.0.0" }] }
```

A source checkout is not a release: it registers no MCP server and answers `NOT_RELEASED` rather than call Specter.

## Sign in

Specter has two separate sign-ins:

| Entry | What it signs in |
| --- | --- |
| The `specter` server in `/mcps` | Specter's own MCP tools, with OpenCode's OAuth sign-in. Yours alone. |
| **Specter** in `/connect` | The plugin's own tools and the `specter.saved` source, with the team's API key. |

The key is the team's: everyone who uses it spends from one credit pool and one rate limit, and Specter cannot tell who
made a call. It is sent only to Specter's REST API in the `X-API-Key` header, and never appears in a status line, a
log line or a result.

## Use

The `specter` skill covers reads; `specter-write` covers calls that spend credits or change Specter data. Specter's own
MCP tools appear under the same `specter_` prefix. The plugin's own tools are `specter_search_companies` (free),
`specter_get_company`, `specter_list_saved_searches` (free) and `specter_saved_search_results`.

`specter.saved` lists the companies Specter added to one saved company search since a cursor, as events for a collector
or automation. It reads with the team key and spends one credit per company Specter returns. The scope is the saved
search's id; companies only, metadata only. A cursor older than Specter's 60-day window answers one `gap` and restarts
at the earliest readable line.

## Permissions

The `access` option generates default rules for every agent:

| `access` | Reads | Calls that spend credits, and changes |
| --- | --- | --- |
| `all` (default) | allow | allow |
| `ask-changes` | allow | ask |
| `read-only` | allow | deny |

A tool the plugin has not classified is treated like a change. The last matching rule wins, so an agent's own stricter
rules, your `permissions` and saved approvals still win. `/specter-status` names any agent without the block and shows
the rules to copy into it.

## Troubleshooting

Run `/specter-status` first. Every error starts with one of these codes and ends with one next step.

| Code | When | Next step |
| --- | --- | --- |
| `HOST_UNTESTED` | Start-up, outside `>=2.4.1 <2.5.0` | Update OpenCode or the plugin, or set `allowUntestedHost`. |
| `OPTIONS_INVALID` | Start-up: an option is unknown or has a wrong value | Fix that option in `opencode.json`; the message names it. |
| `SKILLS_INVALID` | Start-up: a shipped skill file is missing or malformed | Reinstall the plugin. |
| `RULES_NOT_ADDED` | Status: the default rules could not be added | Restart OpenCode. |
| `SERVER_NOT_REGISTERED` | Status: the `specter` server or its tools could not be registered | Restart OpenCode. |
| `INTEGRATION_NOT_REGISTERED` | Status: the **Specter** key sign-in could not be added to `/connect` | Restart OpenCode. |
| `KEY_UNAVAILABLE` | OpenCode could not read the key | Run `/connect`, choose **Specter** and paste the key again. |
| `NOT_RELEASED` | A source install tried to call Specter | Use a release tag; a source install sends nothing. |
| `STATUS_UNAVAILABLE` | Status could not be read | Try again in a few seconds; if it persists, restart OpenCode. |
| `AUTH_REQUIRED` | A tool needs the team key and none is connected | Run `/connect`, choose **Specter** and paste the team API key. |
| `INPUT_INVALID` | A tool's input does not fit its schema | Fix the input, then call the tool again. |
| `API_PATH_INVALID` | A request path could leave Specter's REST API | Pass a relative path. |
| `API_UNREACHABLE` | Specter's REST API could not be reached | Check your network, then try again. |
| `API_TIMEOUT` | Specter did not answer within `requestTimeoutMs` | Try again; raise `requestTimeoutMs` if it keeps happening. |
| `API_REDIRECTED` | Specter redirected a change, which is never followed | Check the path, then call the tool again. |
| `API_REDIRECT_LOOP` | Specter redirected more than 5 times | Try again later. |
| `API_REDIRECT_INSECURE` | Specter redirected to a non-HTTPS address | Try again later. |
| `API_REDIRECT_OFF_HOST` | Specter redirected a read outside its REST API | Try again later. |
| `KEY_REJECTED` | Specter refused the team API key | Paste a current key from the API Console in `/connect`. |
| `OUT_OF_CREDITS` | The team's credit budget for the period is spent | Wait for the period to renew, or ask Specter for more credits. |
| `DAILY_CREDIT_CAP_REACHED` | The organisation's daily credit limit is reached | Wait until 00:00 UTC; an admin can ask Specter to change the limit. |
| `UPSTREAM_ERROR` | Specter answered with another error | Follow the message's next step, which names Specter's request ID for a report. |

Scripts use the tools RPC's own codes, listed in [Scripting](docs/scripting.md#errors).

## Uninstall

1. Sign out of the `specter` server: `opencode mcp logout specter`, while the plugin is installed.
2. Remove the key: `opencode auth logout Specter`.
3. Remove the plugin entry from `opencode.json`, then run `opencode reload`.
4. The plugin keeps no data of its own. Remove the default rules you copied into an agent's own `permissions`.

## Links

- [Configuration](docs/configuration.md)
- [Architecture](docs/architecture.md)
- [Scripting](docs/scripting.md)
- [What Specter calls cost](docs/costs.md)
- [Specter's MCP tools, a draft classification](docs/tool-classes.md)
- [Security](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)

MIT licence; see [LICENSE](LICENSE).
