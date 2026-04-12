import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createExampleMcpSession } from "./example-mcp-client.js";

const outputPath = "./ignore/mcp_test_result.md";
const googleSearchQuery = "e=mc2";
const session = await createExampleMcpSession("aidana-test-mcp");

try {
  await session.ensureTools(["file_write", "google_search"]);

  const tools = await session.listTools();
  const workspacePath = session.health.workspacePath;
  const absoluteOutputPath = join(workspacePath, "ignore", "mcp_test_result.md");
  const googleSearchResult = await session.callTextTool("google_search", {
    query: googleSearchQuery,
    topK: 1,
  });

  console.log(JSON.stringify(tools, null, 2));

  const markdown = [
    "# MCP Test Result",
    "",
    `Generated: ${new Date().toISOString()}`,
    `MCP endpoint: ${session.mcpUrl.toString()}`,
    `MCP config: ${session.configPath}`,
    `MCP server entry: ${session.serverName}`,
    `Workspace: ${workspacePath}`,
    "",
    "## Tools",
    "",
    ...tools.tools.map((tool) => `- ${tool.name}: ${tool.description}`),
    "",
    "## Google Search",
    "",
    `Query: ${googleSearchQuery}`,
    "",
    googleSearchResult,
    "",
  ].join("\n");

  await session.callTextTool("file_write", {
      path: outputPath,
      content: markdown,
  });

  await access(absoluteOutputPath);
  const writtenContent = await readFile(absoluteOutputPath, "utf-8");

  console.log(
    JSON.stringify(
      {
        fileWrite: "OK",
        outputPath,
        absoluteOutputPath,
        workspacePath,
        mcpConfigPath: session.configPath,
        mcpServerEntry: session.serverName,
        mcpUrl: session.mcpUrl.toString(),
        googleSearchQuery,
        bytesWritten: Buffer.byteLength(writtenContent, "utf-8"),
      },
      null,
      2,
    ),
  );
} finally {
  await session.close();
}