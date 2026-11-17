// The source contract the plugin bundles: one tag, named the same in package.json, the lockfile, NOTICE and the docs,
// and the tools RPC entry points the plugin imports still exported by it.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import * as toolsRpc from "@we-the-rebel-alliance/source-contract/tools-rpc"
import { PLUGIN_ID } from "../../src/constants.js"
import { TOOLS_RPC_ID } from "../../src/tools-rpc.js"

const root = fileURLToPath(new URL("../..", import.meta.url))
const read = (path: string) => readFileSync(join(root, path), "utf8")
const NAME = "@we-the-rebel-alliance/source-contract"
const TAG = "v0.2.0"

describe("the source contract", () => {
  it(`is pinned to ${TAG} everywhere it is named`, () => {
    const pkg = JSON.parse(read("package.json")) as { devDependencies: Record<string, string> }
    expect(pkg.devDependencies[NAME]).toBe(`github:we-the-rebel-alliance/source-contract#${TAG}`)
    const lock = JSON.parse(read("package-lock.json")) as { packages: Record<string, { version?: string }> }
    expect(lock.packages[`node_modules/${NAME}`]?.version).toBe(TAG.slice(1))
    expect(read("NOTICE")).toContain(`## ${NAME} ${TAG.slice(1)} (MIT)`)
    expect(read("docs/scripting.md")).toContain(`tag ${TAG}`)
    expect(read("src/tools-rpc.ts")).toContain(`tag ${TAG}`)
  })

  it("still exports the tools RPC entry points the plugin imports", () => {
    expect(typeof toolsRpc.registerToolsRpc).toBe("function")
    expect(typeof toolsRpc.toolsRpcId).toBe("function")
    expect(TOOLS_RPC_ID).toBe(`${PLUGIN_ID}.tools`)
  })
})
