// The OpenCode releases this plugin supports and is tested on. SUPPORTED_HOST equals package.json opencode.host;
// TESTED_HOSTS (src/constants.ts) is the one list of tested releases, which the tests and CI use too.
import { SUPPORTED_HOST, TESTED_HOSTS } from "./constants.js"
import { SpecterPluginError } from "./errors.js"

type Version = readonly [number, number, number]

/**
 * The range's two bounds, parsed from `SUPPORTED_HOST` so the code and `package.json` cannot drift. The constant is
 * `>=<lowest> <<above>`: the lowest release starts the plugin, and the first release of the next line ends it.
 */
const BOUNDS = /^>=(\d+)\.(\d+)\.(\d+) <(\d+)\.(\d+)\.(\d+)$/.exec(SUPPORTED_HOST)
if (BOUNDS === null) throw new Error(`SUPPORTED_HOST is not a supported range: ${SUPPORTED_HOST}`)
const LOWEST: Version = [Number(BOUNDS[1]), Number(BOUNDS[2]), Number(BOUNDS[3])]
const ABOVE: Version = [Number(BOUNDS[4]), Number(BOUNDS[5]), Number(BOUNDS[6])]

/**
 * Refuses an OpenCode release outside the supported range, unless `allowUntested` is set; then it returns a warning
 * for the status. Prereleases, dev builds and unparsable versions are outside it.
 */
export function checkHost(version: string, allowUntested: boolean): string | undefined {
  if (inRange(version)) return undefined
  const message = `OpenCode ${version} is outside the supported range ${SUPPORTED_HOST}.`
  if (!allowUntested) {
    throw new SpecterPluginError("HOST_UNTESTED", message, "Update OpenCode or the plugin, or set the plugin option allowUntestedHost: true.")
  }
  return `${message} It loaded because allowUntestedHost is set.`
}

/** Whether this exact release is one the plugin is tested on. */
export function isTestedHost(version: string): boolean {
  return TESTED_HOSTS.includes(version)
}

function inRange(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) return false
  const parsed: Version = [Number(match[1]), Number(match[2]), Number(match[3])]
  return compare(parsed, LOWEST) >= 0 && compare(parsed, ABOVE) < 0
}

function compare(a: Version, b: Version): number {
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index]! - b[index]!
  }
  return 0
}
