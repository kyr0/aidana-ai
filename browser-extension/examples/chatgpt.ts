/**
 * Example: ChatGPT via the MCP server + browser extension
 *
 * 1. Read ~/.aidana/mcp.json to discover Aidana's MCP HTTP endpoint
 * 2. chatgpt        → send a prompt to ChatGPT and await the response
 *
 * Run with: bun run test:chatgpt
 */
import { createExampleMcpSession } from "./mcp-client.js";

const session = await createExampleMcpSession("example-mcp-chatgpt");

const prompt =
  "What is 2+2? Reply with just the number, nothing else.";

try {
  await session.ensureTools(["chatgpt"]);

  console.log(`[example] ChatGPT prompt: "${prompt}"`);

  const result = await session.callTextTool("chatgpt", { prompt });

  console.log(`[example] ChatGPT response: ${result}`);
} finally {
  await session.close();
}
