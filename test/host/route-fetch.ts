// Replaces globalThis.fetch for this test process, as the host tests do. OpenCode's MCP transport and the
// plugin both call the global fetch at request time, so Specter's fixed hosts can be served by the loopback fake:
// mcp.tryspecter.com (the MCP server and OAuth discovery) and app.tryspecter.com (the REST API). Loopback is allowed
// only to the fake. Every other request fails with EXTERNAL_FETCH_BLOCKED and is recorded, so a test can assert that
// the host never tried to leave the machine.

const ROUTED = [(url: URL) => url.hostname === "mcp.tryspecter.com", (url: URL) => url.hostname === "app.tryspecter.com"]

export interface FetchRouter {
  /** The fake's origin while a host runs; undefined blocks Specter too. */
  target: string | undefined
  /** Origins of fakes that have closed. */
  readonly retired: Set<string>
  /** The origin and path of every blocked request. */
  readonly blocked: string[]
  /** Blocked requests to a closed fake: retries a closed host had already scheduled. */
  readonly stale: string[]
  restore(): void
}

export function routeFetch(): FetchRouter {
  const original = globalThis.fetch
  const router: FetchRouter = {
    target: undefined,
    retired: new Set(),
    blocked: [],
    stale: [],
    restore: () => {
      globalThis.fetch = original
    },
  }
  const routed = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    const target = router.target
    let destination: string | undefined
    if (target && ROUTED.some((matches) => url.protocol === "https:" && matches(url))) destination = `${target}${url.pathname}${url.search}`
    else if (target && url.origin === target) destination = url.href
    if (!destination) {
      ;(router.retired.has(url.origin) ? router.stale : router.blocked).push(`${url.origin}${url.pathname}`)
      throw new Error(`EXTERNAL_FETCH_BLOCKED: the host test does not allow requests to ${url.origin}`)
    }
    // No second hop: a redirect would leave the routed origin.
    return original(new Request(destination, request), { redirect: "error" })
  }
  globalThis.fetch = Object.assign(routed, { preconnect: () => undefined }) as typeof fetch
  return router
}
