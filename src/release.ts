/**
 * Vendor calls run only from a tagged release install. A source install (no release tag on the checkout, and none
 * in the loaded module's URL) must not call Specter. Tests pass `released: true`, or `simulateTaggedRelease`, to
 * keep the handlers. There is no tag to invent: package.json stays 0.0.1 until a release exists.
 */
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const RELEASE_TAG = /(?:^|[#/@])v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?=$|[#/@])/
const SEMVER_TAG = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/
const FLAG = Symbol.for("@joe-broadhead/opencode-specter/tagged-release")
let cached: boolean | undefined

/** The release tag named by an install spec or module URL, such as `@v1.2.3` or `#v1.2.3`. */
export function releaseTagIn(text: string | undefined): string | undefined {
  if (text === undefined) return undefined
  const match = RELEASE_TAG.exec(text)
  return match === null ? undefined : match[0].replace(/^[#/@]/, "")
}

/** True when this process was loaded from a path that names a release tag. A source checkout does not. */
export function installedFromReleaseTag(moduleUrl = import.meta.url): boolean {
  return releaseTagIn(moduleUrl) !== undefined
}

/**
 * Tests, and the host harness, set this so the existing handlers still run against a fake. `undefined` clears it.
 * Production code does not call it, and it does not invent a tag.
 */
export function simulateTaggedRelease(value: boolean | undefined): void {
  const target = globalThis as typeof globalThis & { [FLAG]?: boolean }
  if (value === undefined) {
    delete target[FLAG]
    cached = undefined
    return
  }
  target[FLAG] = value
}

function simulated(): boolean {
  return (globalThis as typeof globalThis & { [FLAG]?: boolean })[FLAG] === true
}

export function isLoopback(url: URL): boolean {
  return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1" || url.hostname === "[::1]"
}

/**
 * Vendor calls are allowed for a simulated release (tests) or a module URL that names a release tag.
 * Anything else is a source install.
 */
export function vendorCallsAllowed(options: { readonly released?: boolean; readonly moduleUrl?: string } = {}): boolean {
  if (options.released === true || simulated()) return true
  if (options.moduleUrl !== undefined) return releaseTagIn(options.moduleUrl) !== undefined
  if (cached !== undefined) return cached
  cached = installedFromReleaseTag() || exactGitTag(packageDir())
  return cached
}

function packageDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "package.json"))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return dirname(fileURLToPath(import.meta.url))
}

/** A checkout whose HEAD is exactly a semver tag. A source branch, and a missing git, are not. */
function exactGitTag(dir: string): boolean {
  try {
    const tag = execFileSync("git", ["-C", dir, "describe", "--exact-match", "--tags"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
    return SEMVER_TAG.test(tag)
  } catch {
    return false
  }
}
