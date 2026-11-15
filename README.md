# Specter for OpenCode

Connects OpenCode to [Specter](https://tryspecter.com)'s deal data, so your agents can find a company and read its
profile and signals, through Specter's hosted MCP server and, in a later release, the plugin's own tools on your team's
Specter API key.

Unofficial; not affiliated with Specter.

Specter is a trademark of its owner; this unofficial plugin is not endorsed by them.

> **Scaffold.** This is v0.0.1 before its first release: the plugin registers Specter's hosted MCP server, declares
> the Specter key sign-in, inserts its default rules and shows its status, and has no tools of its own yet. Nothing in
> it calls Specter's REST API. The tool table fills from a live capture of Specter's server in a later step.

## Requirements

- OpenCode `>=2.2.3 <2.4.0`, tested on 2.2.3, 2.2.4, 2.2.5, 2.2.6, 2.2.7 and 2.3.0. A later 2.2 or 2.3 release loads
  too, and the status marks it untested. Outside `>=2.2.3 <2.4.0` the plugin does not load, unless you set
  [`allowUntestedHost`](docs/configuration.md#options).
- macOS or Linux.
- A Specter seat. Specter's MCP server signs each person in on their own. The plugin's own tools, when they arrive,
  use one team-level Specter API key. TODO(Slice 0, B3): whether API access needs a separate order, and how to request it, is not
  confirmed yet; this README states it once Specter confirms.

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
| **Specter** (in `/connect`) | The plugin's key sign-in: paste the team's Specter API key. | The plugin's own Specter tools, when they arrive. |

The key is the team's: everyone who uses it spends from one credit pool and one rate limit, and Specter cannot tell
who made a call. OpenCode stores the key; the plugin reads it when a call needs it, sends it only to Specter's REST API
in the `X-API-Key` header, and never shows it in an error, a status line, a log line or a result. There is no
environment variable for the key.

TODO(Slice 1, B2): Specter's MCP sign-in flow is not verified yet. Whether it completes in OpenCode with no admin step decides
whether the MCP server ships in the first release.

## Use

Ask for what you need. The `specter` skill tells the model how to use Specter's tools; `specter-write` covers calls that
spend credits or change Specter data.

No tool is classified yet. Specter's own MCP tools appear under the `specter_` prefix once you sign in, and until the
plugin classifies them each one is treated like a change (see [Permissions](#permissions)).

## Permissions

The plugin puts a block of default rules into each agent right after its base `* * allow` rule. The `access` option
generates the block from three classes of tool:

| Class | What it is | `all` (default) | `ask-changes` | `read-only` |
| --- | --- | --- | --- | --- |
| `read` | Free; changes nothing. | allow | allow | allow |
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
the key in `opencode.json`. TODO(Slice 10): the key rotation runbook (who rotates it, and how everyone is told) is written before
the first release.

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
| `UPSTREAM_ERROR` | Specter answered with an error status | The one in the message: for 401 or 403, replace the key; for 429, wait; for 5xx on a call that spends credits, check before you call it again. |

A script's errors from the tools RPC have their own codes, listed in [Scripting](docs/scripting.md#errors).

## Uninstall

1. Sign out of the `specter` server: `opencode mcp logout specter`, while the plugin is installed.
2. Remove the key: `opencode auth logout Specter`.
3. Remove the plugin with `opencode plugin remove github:joe-broadhead/opencode-specter#v0.0.1`, then
   `opencode reload`.
4. The plugin keeps no data of its own. Remove the default rules you copied into agents' own `permissions`.

## Known limits

- **No tools yet.** Specter's MCP tools are not classified until the plugin captures the live server's tool list, and
  the plugin's own tools arrive in a later release.
- **One team key.** It cannot be scoped down per person (assumed until Specter confirms), and every call with it
  spends from one credit pool.
- **Credit costs are unknown.** Whether Specter's MCP calls spend credits, and what each REST call costs, is not
  measured yet. A result reports what it spent only if Specter's response says so; the plugin never estimates.
- **Retries.** A free read is retried on a rate limit or a server error, honouring `Retry-After`; a call that may spend
  credits is never retried.
- **No browser automation.** Specter's terms forbid automated access outside its API; the plugin never drives the
  website.
- **Specter content is not trusted.** A result can carry instructions; the skills tell the model not to follow them.
- **Hosts and platforms.** Tested on OpenCode 2.2.3, 2.2.4, 2.2.5, 2.2.6, 2.2.7 and 2.3.0, on macOS or Linux.

## Links

- [Configuration](docs/configuration.md)
- [Architecture](docs/architecture.md)
- [Scripting](docs/scripting.md)
- [In Jelly](docs/jelly.md)
- [Security](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)

MIT licence; see [LICENSE](LICENSE).
