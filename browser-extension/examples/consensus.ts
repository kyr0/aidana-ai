/**
 * Example: Consensus.app research query via the MCP server + browser extension
 *
 * 1. Read ~/.aidana/mcp.json to discover Aidana's MCP HTTP endpoint
 * 2. consensus → ask a research question and return AI-generated answer as Markdown
 *
 * Run with: bun run test:consensus
 */
import { createExampleMcpSession } from "./mcp-client.js";

const session = await createExampleMcpSession("example-mcp-consensus");

const query = "Does creatine improve cognitive performance?";

try {
  await session.ensureTools(["consensus"]);

  console.log(`[example] Consensus query: "${query}"`);

  const result = await session.callTextTool("consensus", { query });

  console.log(`[example] Consensus result:\n${result}`);
} finally {
  await session.close();
}
