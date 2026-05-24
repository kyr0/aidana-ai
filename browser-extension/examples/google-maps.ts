/**
 * Example: Google Maps via the MCP server + browser extension
 *
 * 1. Read ~/.aidana/mcp.json to discover Aidana's MCP HTTP endpoint
 * 2. google_maps  → search Google Maps for POIs at a location
 *
 * Run with: bun run test:google-maps
 */
import { createExampleMcpSession } from "./mcp-client.js";

const session = await createExampleMcpSession("example-mcp-google-maps");

const query = "restaurants in Berlin";

try {
  await session.ensureTools(["google_maps"]);

  console.log(`[example] Google Maps query: "${query}"`);

  const result = await session.callTextTool("google_maps", { query });

  console.log(`[example] Google Maps result:\n${result}`);
} finally {
  await session.close();
}
