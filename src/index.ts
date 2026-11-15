import { MCP_URL } from "./constants.js"
import { createSpecterPlugin } from "./plugin.js"

export default createSpecterPlugin({ endpoint: MCP_URL })
