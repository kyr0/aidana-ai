/**
 * Example: Scrape a URL via the MCP server + browser extension
 *
 * 1. Read ~/.aidana/mcp.json to discover Aidana's MCP HTTP endpoint
 * 2. scrape → navigate to a URL and return the page content as Markdown
 *
 * Run with: bun run test:scrape
 */
import { createExampleMcpSession } from "./mcp-client.js";

const session = await createExampleMcpSession("example-mcp-scrape");

const url = "https://consensus.app/papers/creatine-supplementation-research-fails-to-support-the-mcmorris-hale/4574d59023e55588bb76bc697cc61762/";

try {
  await session.ensureTools(["scrape"]);

  console.log(`[example] Scrape URL: "${url}"`);

  const result = await session.callTextTool("scrape", { url, format: "md" });

  console.log(`[example] Scrape result:\n${result}`);
} finally {
  await session.close();
}
