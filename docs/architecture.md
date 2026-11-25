# Architecture

Unofficial plugin. Not affiliated with Specter.

## Layers

| Layer | Module | What it does |
| --- | --- | --- |
| Entry | `src/index.ts` | `Plugin.define` and one `register` call; `assertHost` first. |
| Manifest | `src/manifest.ts` | Reads and validates `capabilities` from the installed `package.json`; the register, access and accounts use the one value. |
| Accounts | `src/accounts.ts` | One Specter MCP server per alias through the contract's `accounts` module, and the separate `specter-team` key integration. |
| Handlers | `src/handlers/` | One handler per method: `status`, `probe`, `events_list`, `search_companies`, `get_company`, `list_saved_searches`, `saved_search_results`. |
| Provider | `src/provider/` | The REST client (`request.ts`), Specter's records and previews (`companies.ts`), the saved-search cursor and gap (`saved.ts`), the client (`specter.ts`), and the one place its addresses and headers are named (`endpoints.ts`). |
| Skills | `src/skills.ts` | Reads and validates `skills/<id>/SKILL.md`; setup registers each through `ctx.skill.transform`. |

`src/index.ts` wires doors 1–3 through `register(ctx, manifest, handlers)`; no handler adds a tool, registers an RPC method,
evaluates a permission rule or checks an account. `register` validates every input and answer, resolves `account`, calls
`ctx.permission.assert` once per call, applies the generated access rules and builds the bus from its one RPC registration.
The gate asserts the method's action `<name>.<method>` and every operation the manifest declares on
`<alias>:<operation>`; the handlers rely on that one gate and do not assert again.

The manifest declares no bus events. The pass-through MCP tools are the vendor's own; this plugin makes no provider write,
and a nudge after one would need a per-request hook, which the standard bans, so no `changed` event is declared.

## Accounts and sign-ins

The account mechanism is `mcp`: `registerAccounts` registers one Specter MCP server per alias (`specter`,
`specter-<alias>`), each with its own OAuth. The team key is not an account: `registerSpecterAccounts` declares the
`specter-team` integration with one `key` method, and reads the key at call time through
`ctx.integration.connection.active` and `.resolve`. A missing key is `NEEDS_SIGN_IN`, whose next step names `/connect`.

Nothing is cached. Every call reads the key, sends it only to the REST base, and stores no response: status makes no
upstream call, and the saved-search cursor lives in the consumer's state, bound to plugin, source, account and scope.

## Provider

- `src/provider/endpoints.ts` names Specter's MCP URL, REST base, `X-API-Key` header and support address once.
- `src/provider/request.ts` sends one request at a time, handles redirects by hand, caps the body, and retries only a free
  read. A call that may spend credits is never retried, because Specter may already have charged the first attempt.
- `src/provider/errors.ts` maps Specter's documented answers to the contract's codes: 401 and key-refusing 403s are
  `NEEDS_SIGN_IN`; 402 is the provider's credit limit (`RATE_LIMITED`, with Specter's wait); a retention 422 is
  `CURSOR_EXPIRED`; other 400/404/422 answers are `INPUT_INVALID`; 429 is `RATE_LIMITED`; a 5xx is `UNAVAILABLE`.
- `src/provider/companies.ts` checks the records and cuts them to the fields the plugin uses. A record it does not
  recognise fails the page, never drops the item.
- `src/provider/saved.ts` is the feed's pure state machine: a cursor carries a window, the offset reached, a lookahead
  cutoff, a tail of anchors and compact hashes of the companies already listed. It never carries ids or content, and its
  worst case is under the contract's 1,024-character cursor limit.

## OpenCode APIs

Only public `@opencode/plugin` 2.4.1 APIs: `Plugin.define`, `ctx.app.version`, `ctx.options`, `ctx.agent`,
`ctx.integration`, `ctx.mcp`, `ctx.permission`, `ctx.rpc`, `ctx.skill` and `ctx.tool` through the contract's modules.
No private host module and no internal import.

## Build and tests

`scripts/build.mjs` bundles `src/index.ts` into one self-contained ESM file, `dist/index.js`, leaving only
`@opencode/plugin` and Node built-ins external. The contract is a devDependency and is bundled; the kit is never bundled.
`dist/` is committed, because an OpenCode install of the tag runs no build: regenerate it with `npm run bundle`, and CI
runs `npm run bundle && git diff --exit-code dist/` so a stale bundle fails. `scripts/check.mjs` runs the plugin's
typecheck, bundle, unit and conformance-fixture suites, the real 2.4.1 host suite, the pack suite and
`plugin-kit check`.
