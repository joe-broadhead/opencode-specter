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
/** One install's source, as `ctx.plugin.list` reports it. */
export interface InstallSource {
  readonly type?: string
  readonly target?: string
  readonly version?: string
  readonly path?: string
}

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
  if (value === undefined) delete target[FLAG]
  else target[FLAG] = value
}

function simulated(): boolean {
  return (globalThis as typeof globalThis & { [FLAG]?: boolean })[FLAG] === true
}

export function isLoopback(url: URL): boolean {
  return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1" || url.hostname === "[::1]"
}

/** True only for a real semver tag on this install, or a test that simulated one. */
export function installAllows(source?: InstallSource): boolean {
  if (simulated()) return true
  if (source?.type === "package") {
    // The host reports the spec in `target` (`…#v0.0.1`) and the resolved commit in `version`; only the tag counts.
    const at = source.target === undefined ? -1 : source.target.lastIndexOf("#")
    return at !== -1 && SEMVER_TAG.test(decodeTag(source.target!.slice(at + 1)))
  }
  if (source?.type === "local") return exactGitTag(source.path ?? "")
  if (source?.type === "builtin" || source?.type === "sdk") return false
  return installedFromReleaseTag() || exactGitTag(packageDir())
}

function decodeTag(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

let hostList: (() => unknown) | undefined
let verdict: boolean | undefined
let inflight: Promise<boolean> | undefined

/** The plugin's `setup` hands over `ctx.plugin.list`: the host does not list the plugin itself until after setup. */
export function configureReleaseGate(list: () => unknown): void {
  hostList = list
  verdict = undefined
}

/**
 * Whether a call may reach Specter. On the first production call it reads the host's own report of this install: a
 * package install's `target` carries its tag, and its folder has no `.git`. Until that entry appears the git-tag and
 * module-URL fallbacks decide, and a source install stays gated. Tests pass `released`, or simulate a release.
 */
export async function vendorCallsAllowed(options: { readonly released?: boolean; readonly moduleUrl?: string } = {}): Promise<boolean> {
  if (options.released === true || simulated()) return true
  if (options.moduleUrl !== undefined) return releaseTagIn(options.moduleUrl) !== undefined
  if (verdict !== undefined) return verdict
  inflight ??= (async () => {
    const source = await sourceFromHost()
    if (source === undefined) return installedFromReleaseTag() || exactGitTag(packageDir())
    verdict = installAllows(source)
    return verdict
  })().finally(() => {
    inflight = undefined
  })
  return inflight
}

/**
 * A host call bounded in time: a host that never answers must not hold a release decision (and the call behind it)
 * open, and a failed read leaves the git fallback, which fails closed.
 */
async function bounded(answer: Promise<unknown>): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      answer,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("the host did not answer in time")), 1500)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function sourceFromHost(): Promise<InstallSource | undefined> {
  const list = hostList
  if (list === undefined) return undefined
  const target = list()
  if (typeof target !== "function") return undefined
  const call = target as (input?: unknown) => Promise<unknown>
  for (const arg of [undefined, {}]) {
    try {
      const found = sourceFromList(await bounded(arg === undefined ? call() : call(arg)))
      if (found !== undefined) return found
    } catch {
      // Try the other calling convention, then leave the fallbacks to decide.
    }
  }
  return undefined
}

function sourceFromList(result: unknown): InstallSource | undefined {
  const items = Array.isArray(result) ? result : isRecord(result) && Array.isArray(result.data) ? result.data : []
  const mine = items.find((item) => isRecord(item) && item.id === "specter.deals")
  if (!isRecord(mine)) return undefined
  const source = isRecord(mine.source) ? mine.source : mine
  const type = typeof source.type === "string" ? source.type : undefined
  const target = typeof source.target === "string" ? source.target : undefined
  const version = typeof source.version === "string" ? source.version : undefined
  const path = typeof source.path === "string" ? source.path : undefined
  if (!type && !target && !path) return undefined
  return { ...(type ? { type } : {}), ...(target ? { target } : {}), ...(version ? { version } : {}), ...(path ? { path } : {}) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
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

/**
 * A checkout whose HEAD is exactly a semver tag. A source branch, and a missing git, are not. Exported so a test can
 * prove both answers; production calls it with `packageDir()`.
 */
export function exactGitTag(dir: string): boolean {
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
