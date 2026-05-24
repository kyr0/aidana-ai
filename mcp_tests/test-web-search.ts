/**
 * Test for the web_search aggregate MCP tool.
 *
 * Run with:
 *   cd browser-extension && bun run ../test-web-search.ts
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";

const MCP_URL = "http://127.0.0.1:3211/mcp";
const HEALTH_URL = "http://127.0.0.1:3211/healthz";

async function main(): Promise<void> {
  console.log("=== web_search MCP Tool Test ===\n");

  // Step 1: Check health
  console.log("[1] Checking health endpoint...");
  try {
    const healthRes = await fetch(HEALTH_URL);
    console.log(`    Health status: ${healthRes.status}`);
    if (healthRes.ok) {
      const health = await healthRes.json();
      console.log(`    OK:`, JSON.stringify(health, null, 2));
    }
  } catch (err) {
    console.error(`    Health check failed: ${err}`);
    process.exit(1);
  }

  // Step 2: Connect via SDK
  console.log("\n[2] Connecting via SDK StreamableHTTPClientTransport...");
  const client = new Client({
    name: "web-search-test",
    version: "0.0.1",
  });

  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));

  try {
    await client.connect(transport);
    console.log("    Connected successfully!");

    // Step 3: List tools and verify web_search exists
    console.log("\n[3] Listing tools...");
    const tools = await client.request(
      { method: "tools/list", params: {} },
      ListToolsResultSchema,
    );
    const toolNames = tools.tools.map((t) => t.name);
    console.log(`    Found ${toolNames.length} tools: ${toolNames.join(", ")}`);

    if (!toolNames.includes("web_search")) {
      console.error("    ERROR: web_search tool not found!");
      process.exit(1);
    }
    console.log("    web_search tool found!");

    // Step 4: Call web_search with a simple query
    console.log("\n[4] Calling web_search{query: 'what is 2+2', topK: 1, format: 'md'}...");
    const result = await client.callTool({
      name: "web_search",
      arguments: {
        query: "what is 2+2",
        topK: 1,
        format: "md",
        closeTab: true,
      },
    });

    const textContent = (result.content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n");

    console.log("    Response:");
    console.log(textContent.substring(0, 2000));

    // Parse and validate structure
    const parsed = JSON.parse(textContent);
    console.log("\n[5] Validating response structure...");

    if (!parsed.query) {
      console.error("    ERROR: Missing 'query' field");
      process.exit(1);
    }
    console.log(`    query: "${parsed.query}"`);

    if (!Array.isArray(parsed.results)) {
      console.error("    ERROR: 'results' is not an array");
      process.exit(1);
    }
    console.log(`    results: ${parsed.results.length} item(s)`);

    if (parsed.results.length > 0) {
      const first = parsed.results[0];
      console.log(`    first result: title="${first.title}", url="${first.url}"`);
      console.log(`    content length: ${first.content?.length ?? 0} chars`);
    }

    if (!Array.isArray(parsed.errors)) {
      console.error("    ERROR: 'errors' is not an array");
      process.exit(1);
    }
    console.log(`    errors: ${parsed.errors.length} item(s)`);

    if (parsed.errors.length > 0) {
      console.log("    error details:", JSON.stringify(parsed.errors, null, 2));
    }

    console.log("\n=== All tests passed ===");
  } catch (err) {
    console.error(`    Test failed: ${err}`);
    process.exit(1);
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
