/**
 * Example: Google Search via the MCP server + browser extension
 *
 * 1. Read ~/.aidana/mcp.json to discover Aidana's MCP HTTP endpoint
 * 2. google_search  → search Google and return top results as Markdown
 *
 * Run with: bun run test:google-search
 */
import { createExampleMcpSession } from "./mcp-client.js";

const session = await createExampleMcpSession("example-mcp-google-search");

const query = "London";

try {
  await session.ensureTools(["google_search"]);

  console.log(`[example] Google search query: "${query}"`);

  const result = await session.callTextTool("google_search", { query });

  console.log(`[example] Google search result:\n${result}`);
} finally {
  await session.close();
}
