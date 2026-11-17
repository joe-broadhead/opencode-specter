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
| `src/tool-spec.ts` | The plugin's own tools as specs (opencode-gws's pattern): one spec feeds the model's tool and the scripts' method. |
| `src/tools.ts` | The namespace description, `OWN_TOOLS`, `isServerTool`, and the count of the server's tools. |
| `src/credential.ts` | The `specter` key integration, and reading the key at call time. |
| `src/key-check.ts` | The key check: one free `GET /organization/credits` per key, read as Specter's public docs describe the answers. |
| `src/api/request.ts` | The REST client (opencode-github's structure). No endpoint is called yet. |
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
jitter that honour `Retry-After`; a `spend` call is never retried, because it may already have been charged, and a
`write` call is not retried because it is not known to be idempotent. These retries are new to the family.

## Status, RPC and the TUI view

`/specter-status`, the `/specter` dialog and the status RPC render one status model. Status makes no upstream call.

## Tools RPC

`specter.deals.tools`, the source contract's transport with Specter's plugin value. Scripts call classified tools
with no model, as a session and its agent, under a prior allow.
