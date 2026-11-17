// Default permission rules for Specter's tools, inserted into each agent right after its base `* * allow` rule.
// OpenCode applies the last matching rule, so the agent's own stricter rules (Plan, Explore), the user's `permissions`
// rules and saved approvals all still win. The `access` option generates the block from the three tool classes (D2).
import type { Plugin } from "@opencode/plugin"
import { type Access, errorText } from "./constants.js"
import { reasonOf } from "./redact.js"
import { mcpTools, type ToolClass } from "./specter-tools.js"
import { RESULTS_OPERATION, SUGGEST_OPERATION } from "./source/operations.js"
import { OWN_TOOL_CLASSES, TOOL_PREFIX } from "./tools.js"

export type Rule = { readonly action: string; readonly resource: string; readonly effect: "allow" | "ask" | "deny" }

const rule = (tool: string, effect: Rule["effect"]): Rule => ({ action: `${TOOL_PREFIX}${tool}`, resource: "*", effect })

/** What a call that spends credits or changes data gets at each access (D1). */
export function changeEffect(access: Access): Rule["effect"] {
  return access === "all" ? "allow" : access === "ask-changes" ? "ask" : "deny"
}

/**
 * The two provider operations the plugin asserts on a resource, `<account>:<operation>`, rather than on `*`: the
 * saved-search results read and the free saved-search list that the source's `scope.suggest` binds. A source read
 * asserts its own action and the operation, so both need a rule; both are reads, so both are allowed at every access.
 */
export const SOURCE_OPERATIONS: readonly string[] = [RESULTS_OPERATION, SUGGEST_OPERATION]

/** Every classified tool, Specter's and the plugin's own, by class, without the prefix. */
export function toolsOf(toolClass: ToolClass): string[] {
  return [...new Set([...mcpTools(toolClass), ...Object.entries(OWN_TOOL_CLASSES).filter(([, value]) => value === toolClass).map(([name]) => name)])].sort()
}

/**
 * Broad first, narrow last, because the last matching rule wins. The first rule, `specter_*`, gives every tool the
 * change effect, so a tool the plugin has not classified (Specter's MCP tools, until a live capture classifies them) is
 * treated like a change. `read` tools are always allowed; `spend` and `write` tools get the change effect: allowed
 * under `all`, asked under `ask-changes`, denied under `read-only`. The last two rules allow the operations a source
 * read asserts on its own resource, so a read the host allows is not asked about again underneath.
 */
export function defaultRules(access: Access = "all"): Rule[] {
  const change = changeEffect(access)
  return [
    rule("*", change),
    ...toolsOf("read").map((name) => rule(name, "allow")),
    ...toolsOf("spend").map((name) => rule(name, change)),
    ...toolsOf("write").map((name) => rule(name, change)),
    ...SOURCE_OPERATIONS.map((operation): Rule => ({ action: `${TOOL_PREFIX}read`, resource: `default:${operation}`, effect: "allow" })),
  ]
}

const isBaseAllow = (item: Rule) => item.action === "*" && item.resource === "*" && item.effect === "allow"
const same = (a: Rule, b: Rule) => a.action === b.action && a.resource === b.resource && a.effect === b.effect

/**
 * Inserts `defaults` right after the first base allow rule, unless the block is already somewhere after it (other
 * plugins insert at the same place). Agents without one are unchanged.
 */
export function insertDefaults<R extends Rule>(rules: readonly R[], defaults: readonly R[]): R[] {
  const base = rules.findIndex(isBaseAllow)
  if (base === -1 || hasBlockAfter(rules, base, defaults)) return [...rules]
  return [...rules.slice(0, base + 1), ...defaults.map((item) => ({ ...item })), ...rules.slice(base + 1)]
}

/** A Specter tool the plugin does not know: what an agent's rules do for it shows whether a new tool would run unasked. */
const UNKNOWN_TOOL = `${TOOL_PREFIX}unknown_tool`

/**
 * Agents without the default block whose own rules would let an unknown Specter tool run without asking. OpenCode
 * creates agents defined only in the user's config after plugins run, so they never receive the block.
 */
export function unguardedAgents(agents: readonly { readonly id: string; readonly permissions: readonly Rule[] }[], access: Access = "all"): string[] {
  const defaults = defaultRules(access)
  return agents
    .filter((agent) => !hasBlockAfter(agent.permissions, agent.permissions.findIndex(isBaseAllow), defaults))
    .filter((agent) => effectOf(agent.permissions, UNKNOWN_TOOL) === "allow")
    .map((agent) => agent.id)
}

/** OpenCode's wildcards: `*` matches any run of characters and `?` one character, over the whole text. */
export const matches = (pattern: string, value: string) =>
  new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`).test(value)

/** The effect of `rules` for one call: the last rule whose action and resource both match wins, and no match asks. */
export function effectOf(rules: readonly Rule[], action: string, resource = "*"): Rule["effect"] {
  return rules.findLast((item) => matches(item.action, action) && matches(item.resource, resource))?.effect ?? "ask"
}

function hasBlockAfter(rules: readonly Rule[], base: number, defaults: readonly Rule[]): boolean {
  if (base === -1) return false
  for (let start = base + 1; start + defaults.length <= rules.length; start++) {
    if (defaults.every((item, index) => rules[start + index] !== undefined && same(rules[start + index]!, item))) return true
  }
  return false
}

type AgentContext = { readonly agent: Pick<Plugin.Context["agent"], "transform"> }

/** Registers the default rules for every agent. Synchronous and never throws; a failure is kept for status. */
export async function registerPermissionDefaults(
  ctx: AgentContext,
  access: Access,
  report: (problem: string | undefined) => void,
): Promise<{ dispose(): Promise<void> }> {
  const defaults = defaultRules(access)
  return ctx.agent.transform((editor) => {
    try {
      for (const agent of editor.list()) {
        editor.update(agent.id, (item) => {
          item.permissions = insertDefaults(item.permissions, defaults)
        })
      }
      report(undefined)
    } catch (error) {
      report(errorText("RULES_NOT_ADDED", `Specter's default permission rules could not be added (${reasonOf(error)}), so Specter tools may run without asking.`, "Restart OpenCode."))
    }
  })
}
