# Contributing

## Setup

- Node.js 22.12 or later, with npm. CI uses Node.js 24.
- Bun 1.4 (CI uses 1.4.4). The conformance, host and pack tests run with `bun test`.
- macOS or Linux.

```sh
git clone https://github.com/we-the-rebel-alliance/specter-plugin.git
cd specter-plugin
npm ci --ignore-scripts
npm run check
```

No dependency needs install scripts, and OpenCode installs plugins without them, so always pass `--ignore-scripts`.

### Run your checkout in OpenCode

Build it, then add the clone's path to `plugins` in your OpenCode config instead of the release install:

```sh
npm run build
```

```json
{ "plugins": [{ "package": "/path/to/specter-plugin" }] }
```

## `npm run check`

One command, `scripts/check.mjs`, runs every stage in order and stops at the first failure. `node scripts/check.mjs
<stage>...` runs only the named stages.

| Stage | What it does |
| --- | --- |
| `typecheck` | `tsc` over `src/` and the tests. |
| `unit` | Vitest over `test/unit/`. |
| `conformance` | The source contract's conformance kit over the `specter.saved` source, under Bun. |
| `build` | esbuild bundles `dist/index.js` and `dist/tui.js`, and checks `NOTICE`. |
| `icons` | The family icon contract. |
| `host` | The built plugin in an embedded OpenCode 2.4.1 host, against a loopback fake. |
| `pack` | Packs, installs with scripts disabled and imports both entries. |
| `forbidden` | The forbidden APIs and private names. |
| `copies` | The shared kit files against their pinned hashes. |
| `whitelist` | `package.json` and `dist/` against the approved package shape. |
| `actionlint` | The workflows, when `actionlint` is on PATH. |

## Capturing Specter's tools

`npm run capture` (`scripts/capture-tools.mjs`) writes `test/fixtures/live-tools.json` from the signed-in server. Run
it by hand, never in CI, and commit tool names and schemas only, no company data.

## Releases

Versions follow semantic versioning on the plugin's contract: its options, the server name `specter`, the
`/specter-status` command, the status RPC, the skill names and the default rules.

Each release is the GitHub tag `v<version>`, made only by `.github/workflows/release.yml` after the owner approves the
`release` environment; the copied release kit is replaced with `plugin-kit` when the contract lands. While changes
land, their notes go under the unreleased section of `CHANGELOG.md`. `package.json` stays `"private": true` and in
canonical form.

CI is one job, `ci`, on Node 24: a pull request from a fork runs on `ubuntu-24.04`, and a same-repository pull request
or a push may use the org runner when `CI_RUNNER_PUBLIC` is set. It runs `npm ci --ignore-scripts` and `npm run check`.
