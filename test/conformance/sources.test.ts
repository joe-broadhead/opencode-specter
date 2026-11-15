// The source contract's conformance kit over the source package.json declares. Specter declares no source yet:
// `sources`, `specter_events_list` and the probe arrive in Slice 8 (the saved search's net-new results, with the
// saved-search id as the scope key, SPEC.md §7). This placeholder keeps the check gate's `conformance` stage (D4) in
// place until then.
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { sources?: unknown }

test("declares no source until Slice 8", () => {
  expect(pkg.sources).toBeUndefined()
})

test.todo("Slice 8: run the source contract's conformance kit over the declared source, and write reports/conformance-report.json")
