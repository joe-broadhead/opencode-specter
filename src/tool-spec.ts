/**
 * The plugin's own Specter tools, one spec each, in opencode-gws's pattern: a spec is the one definition of a tool, and
 * it feeds both the model's tool (`buildTool`) and the scripts' tools RPC method (`scriptMethod`), so the two cannot
 * drift apart. A tool validates its input with its zod schema, runs, and returns `{ output, content, metadata }`: Code
 * Mode receives `output`; a direct call shows `content`, compact JSON cut at the inline cap with a note to narrow the
 * query. A plugin error reaches the model as a tool error with metadata `{ code, next }`.
 *
 * `read-tools.ts` holds the four REST tools and their tables; `source/` holds the source contract's `events_list` and
 * `probe`, which are methods in the same namespace but are not specs here.
 */
import { Error as ToolError } from "@opencode/plugin/promise/tool"
import type { JsonSchema, MethodClass, PluginMethod } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import * as z from "zod"
import { SERVER_NAME } from "./constants.js"
import { SpecterPluginError } from "./errors.js"
import type { ToolClass } from "./specter-tools.js"

/** Inline cap for a direct call's text, in bytes, as github_api's. */
export const MAX_INLINE_BYTES = 100_000

/** The call a spec runs for, from the model's tool context or a script's RPC call. */
export interface Call {
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly id: string
  readonly signal: AbortSignal
}

export interface Outcome<O> {
  readonly output: O
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface ToolSpec<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  /** The tool's name without the prefix; the model sees `specter_<name>`. */
  readonly name: string
  /** The permission action: `specter_<name>`. */
  readonly action: string
  readonly class: ToolClass
  readonly description: string
  readonly input: I
  readonly output: O
  run(input: z.output<I>, call: Call): Promise<Outcome<z.output<O>>>
}

/** The source contract has no `spend` class (its classes are read, write, send, export and destructive), so a spend
 * method is described as `write`: a change, as the default rules treat it. The class only describes; the rules decide. */
export const methodClass = (toolClass: ToolClass): MethodClass => (toolClass === "read" ? "read" : "write")

export function parse<I extends z.ZodType>(schema: I, input: unknown): z.output<I> {
  const result = schema.safeParse(input)
  if (result.success) return result.data
  throw new SpecterPluginError("INPUT_INVALID", `The input does not fit the tool's schema: ${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}.`, "Check the input against the tool's schema, then call it again.")
}

/** Compact JSON for a direct call, cut at the inline cap. */
export function render(output: unknown, maxBytes = MAX_INLINE_BYTES): { text: string; truncated: boolean } {
  const text = JSON.stringify(output) ?? ""
  const bytes = Buffer.byteLength(text)
  if (bytes <= maxBytes) return { text, truncated: false }
  const cut = Buffer.from(text).subarray(0, maxBytes).toString("utf8")
  return { text: `${cut}\n…[truncated: ${maxBytes} of ${bytes} bytes shown; narrow the query to see the rest]`, truncated: true }
}

/** A spec as the model's tool, for `ctx.tool.transform`'s `editor.add`. */
export function buildTool(spec: ToolSpec) {
  return {
    name: spec.name,
    description: spec.description,
    input: spec.input,
    output: spec.output,
    options: { namespace: SERVER_NAME, permission: spec.action, codemode: true },
    execute: async (raw: unknown, context: Call) => {
      try {
        const outcome = await spec.run(parse(spec.input, raw), context)
        const rendered = render(outcome.output)
        return { output: outcome.output, content: rendered.text, metadata: { ...outcome.metadata, ...(rendered.truncated ? { truncated: true } : {}) } }
      } catch (error) {
        if (!(error instanceof SpecterPluginError)) throw error
        throw new ToolError({ message: error.message, metadata: { code: error.code, next: error.nextStep } })
      }
    },
  }
}

/** A spec as a tools RPC method: the same input check, the same run. */
export function scriptMethod(spec: ToolSpec): PluginMethod {
  return {
    kind: "plugin",
    name: spec.name,
    action: spec.action,
    class: methodClass(spec.class),
    description: spec.description,
    input: schemaOf(spec.input, "input"),
    output: schemaOf(spec.output, "output"),
    run: async (input, call) => (await spec.run(parse(spec.input, input), call)).output,
  }
}

function schemaOf(schema: z.ZodType, io: "input" | "output"): JsonSchema {
  try {
    return z.toJSONSchema(schema, { io, unrepresentable: "any" }) as JsonSchema
  } catch {
    return { type: "object" }
  }
}
