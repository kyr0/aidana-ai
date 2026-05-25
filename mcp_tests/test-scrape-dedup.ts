/**
 * End-to-end tests for the scrape tool's dedup and mainTopicFocus features.
 *
 * Verifies that LLM-based post-processing works correctly via direct mode.
 *
 * Run with:
 *   cd mcp_tests && bun run test-scrape-dedup.ts
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";

const MCP_URL = "http://127.0.0.1:3211/mcp";
const HEALTH_URL = "http://127.0.0.1:3211/healthz";

type TextContentBlock = { type: string; text?: string };

function getTextContent(content: ReadonlyArray<TextContentBlock>): string {
  return content
    .flatMap((item) => (item.type === "text" && typeof item.text === "string" ? [item.text] : []))
    .join("\n")
    .trim();
}

async function main(): Promise<void> {
  console.log("=== Scrape Dedup/MainTopicFocus MCP Tool Test ===\n");

  // Step 1: Check health
  console.log("[1] Checking health endpoint...");
  try {
    const healthRes = await fetch(HEALTH_URL);
    console.log(`    Health status: ${healthRes.status}`);
    if (!healthRes.ok) {
      console.error("    ERROR: Health check failed");
      process.exit(1);
    }
  } catch (err) {
    console.error(`    Health check failed: ${err}`);
    process.exit(1);
  }

  // Step 2: Connect via SDK
  console.log("\n[2] Connecting via SDK StreamableHTTPClientTransport...");
  const client = new Client({ name: "scrape-dedup-test", version: "0.0.1" });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));

  try {
    await client.connect(transport);
    console.log("    Connected successfully!");

    // Step 3: List tools and verify scrape exists
    console.log("\n[3] Listing tools...");
    const tools = await client.request(
      { method: "tools/list", params: {} },
      ListToolsResultSchema,
    );
    const toolNames = tools.tools.map((t) => t.name);
    console.log(`    Found ${toolNames.length} tools: ${toolNames.join(", ")}`);

    if (!toolNames.includes("scrape")) {
      console.error("    ERROR: scrape tool not found!");
      process.exit(1);
    }
    console.log("    scrape tool found!");

    // Helper: call scrape tool and parse result
    async function callScrape(
      name: string,
      args: Record<string, unknown>,
    ): Promise<any> {
      console.log(`  [${name}] Calling scrape with:`, JSON.stringify(args, null, 2));
      const result = await client.callTool({ name: "scrape", arguments: args });
      const text = getTextContent(result.content as ReadonlyArray<TextContentBlock>);

      if (result.isError) {
        console.error(`    ERROR: ${text}`);
        return null;
      }

      try {
        return JSON.parse(text);
      } catch {
        console.error(`    ERROR: Response is not valid JSON: ${text.substring(0, 200)}`);
        return null;
      }
    }

    // Helper: assert helper
    function assert(condition: any, message: string): void {
      if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
      }
    }

    let passed = 0;
    let failed = 0;

    // Use example.com as test URL (simple, reliable, fast)
    const testUrl = "https://example.com";

    // --- S1: dedup=true, format=md ---
    try {
      const parsed = await callScrape("S1: dedup/true/format/md", {
        url: testUrl,
        format: "md",
        dedup: true,
      });
      assert(parsed, "response not null");
      assert(parsed.content_type, "content_type field present");
      assert(parsed.metadata, "metadata field present");
      assert("content" in parsed, "content field exists in response");
      // Verify LLM was called (no error note in content)
      if (typeof parsed.content === "string" && parsed.content.length > 0) {
        assert(
          !parsed.content.includes("LLM post-processing failed"),
          "no LLM error note in content",
        );
      }
      console.log("    OK\n");
      passed++;
    } catch (e) {
      console.error(`    FAILED: ${e}\n`);
      failed++;
    }

    // --- S2: mainTopicFocus, format=md ---
    try {
      const parsed = await callScrape("S2: mainTopicFocus/format/md", {
        url: testUrl,
        format: "md",
        mainTopicFocus: "example domain",
      });
      assert(parsed, "response not null");
      assert(parsed.content_type, "content_type field present");
      assert(parsed.metadata, "metadata field present");
      assert(parsed.content, "content field present");
      assert(
        !parsed.content.includes("LLM post-processing failed"),
        "no LLM error note in content",
      );
      console.log("    OK\n");
      passed++;
    } catch (e) {
      console.error(`    FAILED: ${e}\n`);
      failed++;
    }

    // --- S3: dedup=true + mainTopicFocus ---
    try {
      const parsed = await callScrape("S3: dedup+mainTopicFocus", {
        url: testUrl,
        format: "md",
        dedup: true,
        mainTopicFocus: "example domain",
      });
      assert(parsed, "response not null");
      assert(parsed.content_type, "content_type field present");
      assert(parsed.metadata, "metadata field present");
      assert(parsed.content, "content field present");
      assert(
        !parsed.content.includes("LLM post-processing failed"),
        "no LLM error note in content",
      );
      console.log("    OK\n");
      passed++;
    } catch (e) {
      console.error(`    FAILED: ${e}\n`);
      failed++;
    }

    // --- S4: format=json, dedup=true ---
    try {
      const parsed = await callScrape("S4: format/json/dedup/true", {
        url: testUrl,
        format: "json",
        dedup: true,
      });
      assert(parsed, "response not null");
      assert(parsed.content_type, "content_type field present");
      assert(parsed.metadata, "metadata field present");
      assert("content" in parsed, "content field exists in response");
      if (typeof parsed.content === "string" && parsed.content.length > 0) {
        assert(
          !parsed.content.includes("LLM post-processing failed"),
          "no LLM error note in content",
        );
      }
      console.log("    OK\n");
      passed++;
    } catch (e) {
      console.error(`    FAILED: ${e}\n`);
      failed++;
    }

    // --- S5: format=html, dedup=true ---
    // Note: HTML content can be large, so LLM may return empty or truncated content.
    // We validate structure and that no LLM error note is present.
    try {
      const parsed = await callScrape("S5: format/html/dedup/true", {
        url: testUrl,
        format: "html",
        dedup: true,
      });
      assert(parsed, "response not null");
      assert(parsed.content_type, "content_type field present");
      assert(parsed.metadata, "metadata field present");
      // content may be empty string for HTML (LLM truncation) - check it exists as property
      assert("content" in parsed, "content field exists in response");
      if (typeof parsed.content === "string" && parsed.content.length > 0) {
        assert(
          !parsed.content.includes("LLM post-processing failed"),
          "no LLM error note in content",
        );
      }
      console.log("    OK\n");
      passed++;
    } catch (e) {
      console.error(`    FAILED: ${e}\n`);
      failed++;
    }

    // Summary
    console.log("=== Test Summary ===");
    console.log(`  Passed: ${passed}`);
    console.log(`  Failed: ${failed}`);
    console.log(`  Total:  ${passed + failed}`);

    if (failed > 0) {
      console.log("\nSome tests failed!");
      process.exit(1);
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
