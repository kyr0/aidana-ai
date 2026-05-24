import { access, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createExampleMcpSession } from "./mcp-client.js";

const session = await createExampleMcpSession("aidana-test-mcp");

try {
  await session.ensureTools([
    "memory_file_save",
    "memory_file_read",
    "memory_file_append",
    "memory_file_meta",
    "memory_search",
    "memory_list_files",
    "memory_file_archive",
    "google_search",
    "scrape",
    "download_file",
  ]);

  const tools = await session.listTools();
  const workspacePath = session.health.workspacePath;

  // -- 1. Save a memory --
  await session.callTextTool("memory_file_save", {
    name: "test-project",
    content: "# Test Project\n\nThis is a test memory file for the MCP memory system.",
    fileType: "note",
    summary: "Test project memory",
    keywords: ["test", "project"],
    relatedTo: [],
  });
  console.log("[OK] memory_file_save");

  // -- 2. Read the memory --
  const readContent = await session.callTextTool("memory_file_read", {
    name: "test-project",
  });
  if (!readContent.includes("Test Project")) {
    throw new Error("memory_file_read: content mismatch");
  }
  console.log("[OK] memory_file_read");

  // -- 3. Append to memory --
  await session.callTextTool("memory_file_append", {
    name: "test-project",
    content: "## Update\n\nAppended content for testing.",
  });
  const appendedContent = await session.callTextTool("memory_file_read", {
    name: "test-project",
  });
  if (!appendedContent.includes("Appended content")) {
    throw new Error("memory_file_append: content not found after append");
  }
  console.log("[OK] memory_file_append");

  // -- 4. Read meta --
  const meta = await session.callTextTool("memory_file_meta", {
    name: "test-project",
  });
  const parsedMeta = JSON.parse(meta);
  if (parsedMeta.fileType !== "note" || parsedMeta.summary !== "Test project memory") {
    throw new Error("memory_file_meta: metadata mismatch");
  }
  console.log("[OK] memory_file_meta");

  // -- 5. Save a child memory --
  await session.callTextTool("memory_file_save", {
    name: "test-task",
    content: "# Test Task\n\nA sub-task related to the test project.",
    fileType: "task",
    summary: "A sub-task for the test project",
    keywords: ["test", "task"],
    relatedTo: ["test-project"],
  });
  console.log("[OK] memory_file_save (child)");

  // -- 6. Search by keyword --
  const searchResult = await session.callTextTool("memory_search", {
    keywords: ["task"],
  });
  if (!searchResult.includes("test-task")) {
    throw new Error("memory_search: expected 'test-task' in results");
  }
  console.log("[OK] memory_search");

  // -- 7. List files (hierarchy) --
  const listResult = await session.callTextTool("memory_list_files", {});
  if (!listResult.includes("test-project") || !listResult.includes("test-task")) {
    throw new Error("memory_list_files: expected both files in output");
  }
  console.log("[OK] memory_list_files");

  // -- 8. Archive --
  await session.callTextTool("memory_file_archive", {
    name: "test-task",
  });
  const archivedMeta = JSON.parse(
    await session.callTextTool("memory_file_meta", { name: "test-task" }),
  );
  if (!archivedMeta.archived) {
    throw new Error("memory_file_archive: file not marked as archived");
  }
  console.log("[OK] memory_file_archive");

  // -- 9. Google Search --
  const googleSearchResult = await session.callTextTool("google_search", {
    query: "e=mc2",
    topK: 1,
  });
  if (!googleSearchResult || googleSearchResult.length < 10) {
    throw new Error("google_search: result too short");
  }
  console.log("[OK] google_search");

  // -- 10. Scrape (format=html) --
  const scrapeHtml = await session.callTextTool("scrape", {
    url: "https://example.com",
    format: "html",
  });
  const parsedHtml = JSON.parse(scrapeHtml);
  if (!parsedHtml.content || !parsedHtml.metadata?.title) {
    throw new Error("scrape html: missing content or metadata");
  }
  console.log("[OK] scrape (format=html)");

  // -- 11. Scrape (format=md) --
  const scrapeMd = await session.callTextTool("scrape", {
    url: "https://example.com",
    format: "md",
  });
  const parsedMd = JSON.parse(scrapeMd);
  if (!parsedMd.content || !parsedMd.metadata?.title) {
    throw new Error("scrape md: missing content or metadata");
  }
  console.log("[OK] scrape (format=md)");

  // -- 12. Scrape (format=json) --
  const scrapeJson = await session.callTextTool("scrape", {
    url: "https://example.com",
    format: "json",
  });
  const parsedJson = JSON.parse(scrapeJson);
  if (!parsedJson.content || !parsedJson.metadata?.title) {
    throw new Error("scrape json: missing content or metadata");
  }
  console.log("[OK] scrape (format=json)");

  // -- 13. Scrape spiegel.de with markdown format and close tab --
  const scrapeSpiegel = await session.callTextTool("scrape", {
    url: "spiegel.de",
    format: "md",
    closeTab: true,
  });
  const parsedSpiegel = JSON.parse(scrapeSpiegel);
  if (!parsedSpiegel.content || !parsedSpiegel.metadata?.title) {
    throw new Error("scrape spiegel.de md: missing content or metadata");
  }
  console.log("[OK] scrape spiegel.de (format=md, closeTab=true)");

  // -- 14. Download file --
  const downloadResult = await session.callTextTool("download_file", {
    url: "https://www.tu-braunschweig.de/fileadmin/Redaktionsgruppen/Einrichtungen/UB/PDF/Schulungen/AG_Schuelerfuehrung___Wikipedia-Einfuehrung__Handout_.pdf",
  });
  const parsedDownload = JSON.parse(downloadResult);
  if (!parsedDownload.localPath || !parsedDownload.fileName) {
    throw new Error("download_file: missing localPath or fileName");
  }
  console.log("[OK] download_file (TU Braunschweig PDF)");

  // -- Cleanup: archive test-project too --
  await session.callTextTool("memory_file_archive", { name: "test-project" });

  // -- Write test report --
  const outputPath = "./ignore/mcp_test_result.md";
  const absoluteOutputPath = join(workspacePath, "ignore", "mcp_test_result.md");

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
    "## Memory System Tests",
    "",
    "- memory_file_save: OK",
    "- memory_file_read: OK",
    "- memory_file_append: OK",
    "- memory_file_meta: OK",
    "- memory_search: OK",
    "- memory_list_files: OK",
    "- memory_file_archive: OK",
    "- google_search: OK",
    "- scrape (format=html): OK",
    "- scrape (format=md): OK",
    "- scrape (format=json): OK",
    "- scrape spiegel.de (format=md, closeTab=true): OK",
    "- download_file: OK",
    "",
    "All tests passed.",
    "",
  ].join("\n");

  // Use the work-queue RPC to write the report (memory tools don't write arbitrary paths)
  const response = await fetch(`http://127.0.0.1:${session.health.workQueuePort}/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "JobApi.setWorkspacePath",
      params: [workspacePath],
    }),
  });
  await response.json();

  // Write via Node fs directly since we have the path
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(join(workspacePath, "ignore"), { recursive: true });
  await writeFile(absoluteOutputPath, markdown, "utf-8");

  await access(absoluteOutputPath);
  const writtenContent = await readFile(absoluteOutputPath, "utf-8");

  console.log(
    JSON.stringify(
      {
        allTests: "PASSED",
        outputPath,
        absoluteOutputPath,
        workspacePath,
        mcpConfigPath: session.configPath,
        mcpServerEntry: session.serverName,
        mcpUrl: session.mcpUrl.toString(),
        bytesWritten: Buffer.byteLength(writtenContent, "utf-8"),
        toolCount: tools.tools.length,
      },
      null,
      2,
    ),
  );
} finally {
  await session.close();
}
