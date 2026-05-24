/**
 * Example: Download a file via the MCP server + browser extension
 *
 * 1. Read ~/.aidana/mcp.json to discover Aidana's MCP HTTP endpoint
 * 2. download_file → download a file from a URL and return the local path
 *
 * Run with: bun run test:download-file
 */
import { createExampleMcpSession } from "./mcp-client.js";

const session = await createExampleMcpSession("example-mcp-download-file");

const url = "https://eprints.chi.ac.uk/id/eprint/7473/4/Creatine%20supplementation%20research%20fails%20to%20support%20the%20theoretical%20basis%20for%20an%20effect%20on%20cognition.pdf?utm_source=consensus";

try {
  await session.ensureTools(["download_file"]);

  console.log(`[example] Download URL: "${url}"`);

  const result = await session.callTextTool("download_file", { url });

  console.log(`[example] Download result:\n${result}`);
} finally {
  await session.close();
}
