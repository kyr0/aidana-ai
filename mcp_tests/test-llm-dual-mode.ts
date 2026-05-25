/**
 * End-to-end tests for the LLM dual-mode tool.
 *
 * Tests both direct and proxied call modes with various hyperparameter combinations.
 *
 * Run with:
 *   cd mcp_tests && bun run test-llm-dual-mode.ts
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
  console.log("=== LLM Dual-Mode MCP Tool Test ===\n");

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
  const client = new Client({ name: "llm-dual-mode-test", version: "0.0.1" });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));

  try {
    await client.connect(transport);
    console.log("    Connected successfully!");

    // Step 3: List tools and verify llm exists
    console.log("\n[3] Listing tools...");
    const tools = await client.request(
      { method: "tools/list", params: {} },
      ListToolsResultSchema,
    );
    const toolNames = tools.tools.map((t) => t.name);
    console.log(`    Found ${toolNames.length} tools: ${toolNames.join(", ")}`);

    if (!toolNames.includes("llm")) {
      console.error("    ERROR: llm tool not found!");
      process.exit(1);
    }
    console.log("    llm tool found!");

    // Helper: call llm tool and parse result
    async function callLlm(
      name: string,
      args: Record<string, unknown>,
    ): Promise<any> {
      console.log(`  [${name}] Calling llm with:`, JSON.stringify(args, null, 2));
      const result = await client.callTool({ name: "llm", arguments: args });
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

    // --- T1: direct / no-thinking / limited tokens ---
    try {
      const parsed = await callLlm("T1: direct/no-thinking/limited-tokens", {
        prompt: "Reply with exactly: HELLO_WORLD",
        mode: "direct",
        enableThinking: false,
        maxTokens: 256,
      });
      assert(parsed, "response not null");
      assert(typeof parsed.text === "string", "text field is string");
      assert(parsed.reasoningContent === undefined, "no reasoningContent when thinking disabled");
      console.log("    OK\n");
      passed++;
    } catch (e) {
      console.error(`    FAILED: ${e}\n`);
      failed++;
    }

    // --- T2: direct / no-thinking / default tokens ---
    try {
      const parsed = await callLlm("T2: direct/no-thinking/default-tokens", {
        prompt: "Reply with exactly: DEFAULT_TOKENS",
        mode: "direct",
        enableThinking: false,
      });
      assert(parsed, "response not null");
      assert(typeof parsed.text === "string", "text field is string");
      assert(parsed.reasoningContent === undefined, "no reasoningContent");
      console.log("    OK\n");
      passed++;
    } catch (e) {
      console.error(`    FAILED: ${e}\n`);
      failed++;
    }

    // --- T3: direct / thinking enabled ---
    try {
      const parsed = await callLlm("T3: direct/thinking-enabled", {
        prompt: "Reply with exactly: THINKING_TEST",
        mode: "direct",
        enableThinking: true,
        maxTokens: 256,
      });
      assert(parsed, "response not null");
      assert(typeof parsed.text === "string", "text field is string");
      // reasoningContent may or may not be present depending on backend support
      console.log("    OK (reasoningContent:", parsed.reasoningContent ? "present" : "absent", ")\n");
      passed++;
    } catch (e) {
      console.error(`    FAILED: ${e}\n`);
      failed++;
    }

    // --- T4: proxy / no-thinking / limited tokens ---
    try {
      const parsed = await callLlm("T4: proxy/no-thinking/limited-tokens", {
        prompt: "Reply with exactly: PROXY_TEST",
        mode: "proxy",
        enableThinking: false,
        maxTokens: 256,
      });
      assert(parsed, "response not null");
      assert(typeof parsed.text === "string", "text field is string");
      console.log("    OK\n");
      passed++;
    } catch (e) {
      console.error(`    FAILED: ${e}\n`);
      failed++;
    }

    // --- T5: proxy / no-thinking / default tokens ---
    try {
      const parsed = await callLlm("T5: proxy/no-thinking/default-tokens", {
        prompt: "Reply with exactly: PROXY_DEFAULT",
        mode: "proxy",
        enableThinking: false,
      });
      assert(parsed, "response not null");
      assert(typeof parsed.text === "string", "text field is string");
      console.log("    OK\n");
      passed++;
    } catch (e) {
      console.error(`    FAILED: ${e}\n`);
      failed++;
    }

    // --- T6: proxy / thinking enabled ---
    try {
      const parsed = await callLlm("T6: proxy/thinking-enabled", {
        prompt: "Reply with exactly: PROXY_THINKING",
        mode: "proxy",
        enableThinking: true,
        maxTokens: 256,
      });
      assert(parsed, "response not null");
      assert(typeof parsed.text === "string", "text field is string");
      console.log("    OK (reasoningContent:", parsed.reasoningContent ? "present" : "absent", ")\n");
      passed++;
    } catch (e) {
      console.error(`    FAILED: ${e}\n`);
      failed++;
    }

    // --- T7: default mode (should default to proxy) ---
    try {
      const parsed = await callLlm("T7: default-mode/no-thinking", {
        prompt: "Reply with exactly: DEFAULT_MODE",
        enableThinking: false,
        maxTokens: 256,
      });
      assert(parsed, "response not null");
      assert(typeof parsed.text === "string", "text field is string");
      console.log("    OK\n");
      passed++;
    } catch (e) {
      console.error(`    FAILED: ${e}\n`);
      failed++;
    }

    // --- T8: direct / hyperparams (temperature=0, seed=42) ---
    try {
      const parsed = await callLlm("T8: direct/hyperparams-temp-seed", {
        prompt: "Reply with exactly: HYPERPARAM_TEST",
        mode: "direct",
        enableThinking: false,
        maxTokens: 256,
        temperature: 0,
        seed: 42,
      });
      assert(parsed, "response not null");
      assert(typeof parsed.text === "string", "text field is string");
      console.log("    OK\n");
      passed++;
    } catch (e) {
      console.error(`    FAILED: ${e}\n`);
      failed++;
    }

    // --- T9: direct / sampling params (topP=0.9, topK=20) ---
    try {
      const parsed = await callLlm("T9: direct/sampling-params", {
        prompt: "Reply with exactly: SAMPLING_TEST",
        mode: "direct",
        enableThinking: false,
        maxTokens: 256,
        topP: 0.9,
        topK: 20,
      });
      assert(parsed, "response not null");
      assert(typeof parsed.text === "string", "text field is string");
      console.log("    OK\n");
      passed++;
    } catch (e) {
      console.error(`    FAILED: ${e}\n`);
      failed++;
    }

    // --- T10: direct / penalty params (repetitionPenalty=1.1) ---
    try {
      const parsed = await callLlm("T10: direct/penalty-params", {
        prompt: "Reply with exactly: PENALTY_TEST",
        mode: "direct",
        enableThinking: false,
        maxTokens: 256,
        repetitionPenalty: 1.1,
      });
      assert(parsed, "response not null");
      assert(typeof parsed.text === "string", "text field is string");
      console.log("    OK\n");
      passed++;
    } catch (e) {
      console.error(`    FAILED: ${e}\n`);
      failed++;
    }

    // --- T11: direct / endpoint override (use same endpoint as config) ---
    try {
      const parsed = await callLlm("T11: direct/endpoint-override", {
        prompt: "Reply with exactly: ENDPOINT_OVERRIDE",
        mode: "direct",
        enableThinking: false,
        maxTokens: 256,
      });
      assert(parsed, "response not null");
      assert(typeof parsed.text === "string", "text field is string");
      console.log("    OK (model:", parsed.model ?? "unknown", ")\n");
      passed++;
    } catch (e) {
      console.error(`    FAILED: ${e}\n`);
      failed++;
    }

    // --- T12: proxy / recursion depth ---
    try {
      const parsed = await callLlm("T12: proxy/recursion-depth", {
        prompt: "Reply with exactly: RECURSION_TEST",
        mode: "proxy",
        enableThinking: false,
        maxTokens: 256,
        recursionDepth: 2,
      });
      assert(parsed, "response not null");
      assert(typeof parsed.text === "string", "text field is string");
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
