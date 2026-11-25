// The JSON Schema fragments the handlers share. The register validates every input and answer against these, so a shape
// here is the contract a caller sees over every door.
export const EMPTY = { type: "object", properties: {}, additionalProperties: false } as const

export const STRING = { type: "string" } as const

/** What a call cost, in the source's one unit: Specter credits. */
export const COST = {
  type: "object",
  properties: { credits: { type: "integer", minimum: 0 }, note: { type: "string" } },
  required: ["credits"],
  additionalProperties: false,
} as const

/** One saved search as a person confirms it: the id and what tells two searches apart. */
export const SAVED_SEARCH_OPTION = {
  type: "object",
  properties: { id: { type: "string" }, label: { type: "string" } },
  required: ["id", "label"],
  additionalProperties: false,
} as const

/** One company as a tool shows it: the fields this plugin reads, camel-cased. */
export const COMPANY_VIEW = {
  type: "object",
  properties: {
    id: STRING,
    name: STRING,
    domain: STRING,
    website: STRING,
    city: STRING,
    country: STRING,
    industry: STRING,
    growthStage: STRING,
    employeeCount: { type: "integer", minimum: 0 },
    employeeCountRange: STRING,
    foundedYear: { type: "integer", minimum: 0 },
    totalFundingUsd: { type: "number", minimum: 0 },
    lastFundingType: STRING,
    lastUpdated: STRING,
    description: STRING,
  },
  required: ["id"],
  additionalProperties: false,
} as const

/** One domain's matches from the free Find-company-ID call. */
export const RESOLVED_DOMAIN = {
  type: "object",
  properties: {
    domain: STRING,
    matches: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: STRING,
          name: STRING,
          domain: STRING,
          city: STRING,
          country: STRING,
          foundedYear: { type: "integer", minimum: 0 },
          confidence: { type: "number" },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  required: ["domain", "matches"],
  additionalProperties: false,
} as const

/** The contract's untrusted marker: every answer from the provider is data, never instructions. */
export const TRUST = { type: "string", const: "untrusted" } as const
