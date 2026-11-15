# Scripting

Unofficial plugin. Not affiliated with Specter.

A script can call Specter's tools with no model: a cron job, a shell script, or any program that can reach the OpenCode
server. It uses the tools RPC, `specter.deals.tools`, through `opencode api` or an OpenCode client:

```sh
opencode api post /api/rpc/specter.deals.tools/<method> -H "x-opencode-directory:$PWD" -d '{"input":{"sessionID":"<id>","input":{…}}}'
```

The transport is the source contract's (`@we-the-rebel-alliance/source-contract`, tag v0.1.0), shared by the family.

| Method | Class | The tool |
| --- | --- | --- |
| `describe` | none | Lists every method with its class, its permission action and whether it can run now. |

No other method exists yet: Specter's MCP tools become methods once the plugin classifies them, and the plugin's own
tools once they arrive. A method that spends credits is described with the class `write`, because the source contract
has no cost class; the rules, not the class, decide whether it runs.

## A script runs as a session

Every call names a session, and the session must name an agent. Create it for the script once, with the project as its
`location`, and keep its id:

```sh
opencode api post /api/session -d '{"title":"specter digest","agent":"build","location":{"directory":"/path/to/project"}}'
```

Only a prior explicit `allow` for a method's action runs: an `ask` is refused, because nobody can answer it.

## Errors

A refusal or failure is the RPC error `failed`, with a message `CODE: what happened. Next step: what to do.` and
`data: { code, next }`.

| Code | When |
| --- | --- |
| `PERMISSION_DENIED` | The rules ask or deny. An `ask` is refused before dispatch. |
| `SESSION_UNKNOWN` | OpenCode says the session does not exist in this location. |
| `SESSION_AGENT_REQUIRED` | The session names no agent, or an agent that does not exist. |
| `TOOL_UNAVAILABLE` | The server is connected, but Specter does not list the tool now. |
| `SERVER_CONFLICT` | Your config or another plugin defines its own server named `specter` at another address. |
| `AUTH_REQUIRED`, `CONNECTING`, `CONNECTION_FAILED`, `DISABLED`, `NOT_REGISTERED` | The `specter` server needs a sign-in, is still connecting, could not connect, is disabled, or is not registered. `/specter-status` gives the details. |
| `UPSTREAM_ERROR` | Specter's server answered with an error. |
| `CANCELLED` | The request was cancelled. |

A plugin method reports the plugin's own errors, listed in [Errors](configuration.md#errors).

## Status

The status RPC, `specter.deals`, returns what `/specter-status` shows, and makes no call to Specter:

```sh
opencode api post /api/rpc/specter.deals/status -H "x-opencode-directory:$PWD" -d '{"input":{}}'
```

The family's shared fields are `version`, `host`, `state`, `unguardedAgents` and `nextStep`. Specter's own fields
beside them: `server`, `key` (`connected`, the connection's `label`, never the key, and the last `check`), `access`,
`tools` (`visible`, `unknown`), `permissionsBlock`, `shadowedSkills`, `problems` and `hostWarning`.
