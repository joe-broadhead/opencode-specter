// The plugin's only entry: one `Plugin.define` and one `register` call. `assertHost` refuses an untested OpenCode release
// before anything is registered; the accounts module signs in one Specter MCP server per alias and the team-key
// integration; the handlers are wired through the contract's doors; the skills are registered from the package.
import { Plugin } from "@opencode/plugin"
import { assertHost, register } from "@we-the-rebel-alliance/plugin-contract/register"
import { registerSpecterAccounts } from "./accounts.js"
import { createHandlers, type ServerView } from "./handlers/index.js"
import { manifest, version } from "./manifest.js"
import { readOptions } from "./options.js"
import { createProvider } from "./provider/specter.js"
import { loadSkills } from "./skills.js"

/** OpenCode's MCP servers, cut to the states status reports. */
async function serversOf(ctx: Plugin.Context): Promise<readonly ServerView[]> {
  const { data } = await ctx.mcp.list()
  return data.map((server): ServerView => {
    switch (server.status.status) {
      case "connected":
        return { name: server.name, state: "connected" }
      case "pending":
        return { name: server.name, state: "pending" }
      case "disabled":
        return { name: server.name, state: "disabled" }
      case "failed":
      case "needs_auth":
        return { name: server.name, state: server.status.status, error: server.status.error }
    }
  })
}

export default Plugin.define({
  id: manifest.plugin.name,
  async setup(ctx) {
    assertHost(ctx, manifest)
    const options = ctx.options as Readonly<Record<string, unknown>>
    const { requestTimeoutMs } = readOptions(options)

    const accounts = await registerSpecterAccounts(ctx, manifest, options)
    const provider = createProvider({ key: accounts.key, timeoutMs: requestTimeoutMs })
    const skills = await loadSkills()
    const skillRegistration = await ctx.skill.transform((editor) => {
      for (const info of skills) editor.add(info)
    })
    const problems = [...accounts.problems]

    try {
      const handlers = createHandlers({
        manifest,
        version,
        options,
        hostVersion: ctx.app.version,
        provider,
        servers: () => serversOf(ctx),
        problems: () => problems,
      })
      const registration = await register(ctx, manifest, handlers)
      return async () => {
        await registration.dispose()
        await skillRegistration.dispose()
      }
    } catch (error) {
      await skillRegistration.dispose().catch(() => undefined)
      throw error
    }
  },
})
