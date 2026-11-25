// The installed package's `capabilities` manifest and version. The register, the access rules and the accounts module all
// read this one value, validated by the contract's own checker, so the code and package.json cannot drift apart.
//
// The path is relative to this module: `src/manifest.ts` in the repository and `dist/index.js` in the bundle both sit one
// level below the package root.
import { readFileSync } from "node:fs"
import { checkManifest, type Manifest } from "@we-the-rebel-alliance/plugin-contract/manifest"

interface PackageFile {
  readonly name: string
  readonly version: string
  readonly capabilities: unknown
}

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as PackageFile

const checked = checkManifest(pkg.capabilities)
if (!checked.ok) {
  throw new Error(`OPTIONS_INVALID: the package's capabilities manifest is invalid: ${checked.problems.join("; ")}. Next step: fix capabilities in package.json, then reinstall the plugin.`)
}

/** The validated manifest: the one value the register, the access rules and the accounts module use. */
export const manifest: Manifest = checked.value
/** The installed package's version, as status reports it. */
export const version = pkg.version
