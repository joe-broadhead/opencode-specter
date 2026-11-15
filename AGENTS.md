# Repository rules

This repository builds `@joe-broadhead/opencode-specter`, an unofficial OpenCode plugin that registers Specter's hosted
MCP server under the name `specter` and, in later releases, adds its own Specter tools on the team's API key. User docs:
`README.md`, `docs/configuration.md`; contributor docs: `docs/architecture.md`, `CONTRIBUTING.md`.

## Platform

- Use only public APIs of `@opencode/plugin` 2.2.3. The supported host range is exactly `>=2.2.3 <2.4.0`, in
  `package.json` `opencode.host`, `SUPPORTED_HOST` in `src/constants.ts` and `HOST_RANGE` in `scripts/check.mjs`.
  Never write it as `^2.2.3`.
- Test against stock OpenCode 2.2.3, 2.2.4, 2.2.5, 2.2.6, 2.2.7 and 2.3.0. `TESTED_HOSTS` in `src/constants.ts` is the
  one list.
- Keep the plugin ids `specter.deals` (server and status RPC), `specter.deals.tools` (tools RPC) and
  `specter.deals.tui` (TUI), and the server name `specter`.

## Forbidden

`npm run lint` (`scripts/check-forbidden.mjs`) runs its self-test, then scans `src/`, `test/`, `scripts/` and `dist/`,
and every tracked file for the family's private names. Do not use the V1 packages under `@opencode-ai/`,
`ctx.generate.*`, `experimental.policies`, `ctx.experimental.artifact`, imports of `@opencode/ai` or of private
OpenCode source, machine-local paths, or `ctx.permission.hook` anywhere but once in `dist/index.js` (the source
contract's tools RPC).

## Specter

- **No scraping, by anyone.** Specter's terms forbid automated access outside its API, with a large penalty per
  instance. That binds users as well as code: no browser automation of Specter's site, no pasted session cookie, no
  request to any Specter address but the REST API and the MCP server.
- **The team key is the blast radius.** It cannot be scoped down (assumed until Specter confirms). It is sent only to
  the REST base in `X-API-Key`, and never appears in an error, a status line, a log line, a result, a test or a commit.
- **No vendor data in the repository.** Fixtures are invented: no Specter company data, no personal data, no real key.
- **Never invent Specter facts.** Endpoints, tool names, credit costs and the OAuth flow come from Specter's API
  reference, a live capture or a measurement, recorded with its source. Where something is unknown, leave a TODO that
  names the step that resolves it.
- The MCP tool table (`src/specter-tools.ts`) comes only from a live `tools/list` capture (`npm run capture`), never
  from docs.
- Three tool classes: `read` (free), `spend` (costs credits) and `write`. `spend` and `write` are treated like changes;
  a tool not yet classified is treated like a change. A `spend` call is never retried.

## Design

- Permission defaults go through `ctx.agent.transform`, right after each agent's base `* * allow`. No permission hook
  decides them. User rules and saved approvals keep winning.
- A server named `specter` that the user configured is adopted unchanged when it points at Specter's URL, reading only
  `type`, `url` and `oauth === false`, never `headers`; anywhere else it is a conflict.
- Transforms are synchronous and never throw.
- The plugin's own errors are `SpecterPluginError(code, message, nextStep)`, from the one `CODES` table.
- `dist/` holds exactly two self-contained bundles, `index.js` and `tui.js`.

## Package

- No peer and no runtime dependencies: esbuild bundles zod and the source contract into `dist/index.js`. `NOTICE`
  carries their licences.
- Ship prebuilt `dist/` and no `.d.ts` files. No install, `prepare` or `prepack` scripts.
- The shared kit files are byte-for-byte copies, pinned in `scripts/check-copies.mjs`. Change them in every plugin at
  once.
- Releases come only from `.github/workflows/release.yml`, approved by the owner. Never push a tag or a `release/*`
  branch.

## Hygiene

- No tokens, keys, personal data or machine-local paths in the repository. Tests use invented people and firms.
- Host tests isolate `HOME`, the XDG folders, `TMPDIR` and `OPENCODE_TEST_HOME` under the system's `/tmp`, and block
  every request off loopback.
- Run `npm run check` before every commit. Commit messages use `type(scope): summary`.
