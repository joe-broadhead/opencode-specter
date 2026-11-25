# Contributing

## Setup

- Node.js 22.19 or later, with npm. CI uses Node.js 24.
- Bun 1.4 (CI uses 1.4.4). The host and pack suites run with `bun test`.
- macOS or Linux.

```sh
git clone https://github.com/we-the-rebel-alliance/specter-plugin.git
cd specter-plugin
npm ci --ignore-scripts
npm run check
```

No dependency needs install scripts, and OpenCode installs plugins without them, so always pass `--ignore-scripts`.

## `npm run check`

One command, `scripts/check.mjs`, runs every stage in order and stops at the first failure.
`node scripts/check.mjs <stage>...` runs only the named stages.

| Stage | What it does |
| --- | --- |
| `typecheck` | `tsc` over `src/` and the tests. |
| `build` | esbuild bundles `dist/index.js`, and checks `NOTICE`. |
| `unit` | Vitest over `test/unit/`. |
| `conformance` | Replays `fixtures/conformance.json` through the handlers, for two synthetic accounts. |
| `host` | The built plugin in an embedded OpenCode 2.4.1 host, against a loopback fake. |
| `pack` | Packs the tarball, installs it with scripts disabled and imports the server entry. |
| `kit` | `plugin-kit check`: conformance (T0 and T1), generated docs, forbidden patterns, the doc file set and the bundled-kit check. |

`npm run test:kit` runs the `kit` stage alone. `npm run docs` regenerates the generated doc sections.

There are no copied kit scripts. `scripts/` holds only this plugin's build and check; `plugin-kit` owns the rest (see
`AGENTS.md`).

## Fixtures

`fixtures/conformance.json` is recorded from the plugin's own handlers over an invented Specter, with two synthetic
accounts. `test/conformance/` replays it. To change it, regenerate it from a test or the handler table, then run
`npx plugin-kit record` and commit the redacted file; `npx plugin-kit record --check` must pass. Never commit a real
company, person, key or token.

## Running a checkout

Build it, then point a plugin entry at the clone's path:

```sh
npm run build
```

```json
{ "plugins": [{ "package": "/path/to/specter-plugin" }] }
```

A checkout is for development only; the install users run is the release tag.

## Releases

Versions follow semantic versioning. The first release is `v0.0.0`. Releases are cut by the maintainer with
`npx plugin-kit release 0.0.0` on a clean, level `master`, and CI publishes the GitHub release on the tag with `dist/`,
`SHA256SUMS` and the conformance report. Never push a tag yourself.

CI is one job, `ci`, on Ubuntu 24.04 with Node 24: it runs `npm ci --ignore-scripts` and `npm run check`.
