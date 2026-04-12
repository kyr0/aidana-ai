import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";

type TextContentBlock = {
  type: string;
  text?: string;
};

type HttpServerConfigEntry = {
  type?: string;
  url?: string;
};

type McpConfigFile = {
  servers?: Record<string, HttpServerConfigEntry>;
  mcpServers?: Record<string, HttpServerConfigEntry>;
};

export type AidanaMcpHealth = {
  ok: boolean;
  transport: string;
  mcpPort: number;
  mcpPath: string;
  workQueuePort: number;
  workspacePath: string;
};

function aidanaMcpConfigPath(): string {
  return join(homedir(), ".aidana", "mcp.json");
}

function getTextContent(content: ReadonlyArray<TextContentBlock>): string {
  return content
    .flatMap((item) =>
      item.type === "text" && typeof item.text === "string" ? [item.text] : [],
    )
    .join("\n")
    .trim();
}

function pickAidanaServerEntry(
  entries: Record<string, HttpServerConfigEntry> | undefined,
): { name: string; entry: HttpServerConfigEntry } | undefined {
  if (!entries) {
    return undefined;
  }

  const preferredEntry = entries.aidana;
  if (preferredEntry?.type === "http" && preferredEntry.url) {
    return { name: "aidana", entry: preferredEntry };
  }

  for (const [name, entry] of Object.entries(entries)) {
    if (entry.type === "http" && entry.url) {
      return { name, entry };
    }
  }

  return undefined;
}

function mcpHealthUrl(mcpUrl: URL): URL {
  const healthUrl = new URL(mcpUrl);
  healthUrl.pathname = healthUrl.pathname.endsWith("/mcp")
    ? healthUrl.pathname.replace(/\/mcp$/, "/healthz")
    : "/healthz";
  healthUrl.search = "";
  healthUrl.hash = "";
  return healthUrl;
}

export async function loadAidanaMcpConfig(timeoutMs = 30_000): Promise<{
  configPath: string;
  serverName: string;
  mcpUrl: URL;
}> {
  const configPath = aidanaMcpConfigPath();
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const raw = await readFile(configPath, "utf-8");
      const parsed = JSON.parse(raw) as McpConfigFile;
      const selected =
        pickAidanaServerEntry(parsed.servers) ?? pickAidanaServerEntry(parsed.mcpServers);

      if (!selected?.entry.url) {
        throw new Error(`No HTTP MCP server entry with a URL was found in ${configPath}`);
      }

      return {
        configPath,
        serverName: selected.name,
        mcpUrl: new URL(selected.entry.url),
      };
    } catch (error) {
      lastError = error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
  }

  throw new Error(
    `Timed out waiting for MCP config at ${configPath}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

export async function waitForAidanaMcpReady(
  mcpUrl: URL,
  timeoutMs = 30_000,
): Promise<AidanaMcpHealth> {
  const healthUrl = mcpHealthUrl(mcpUrl);
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) {
        return (await response.json()) as AidanaMcpHealth;
      }

      lastError = new Error(`Health endpoint returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }

  throw new Error(
    `Timed out waiting for MCP server readiness at ${healthUrl}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

export async function createExampleMcpSession(clientName: string) {
  const { configPath, serverName, mcpUrl } = await loadAidanaMcpConfig();
  const health = await waitForAidanaMcpReady(mcpUrl);

  const client = new Client({
    name: clientName,
    version: "0.0.1",
  });

  const transport = new StreamableHTTPClientTransport(mcpUrl);

  await client.connect(transport);

  async function listTools() {
    return await client.request(
      { method: "tools/list", params: {} },
      ListToolsResultSchema,
    );
  }

  async function ensureTools(requiredTools: string[]): Promise<Set<string>> {
    const tools = await listTools();
    const toolNames = new Set(tools.tools.map((tool) => tool.name));
    const missingTools = requiredTools.filter((toolName) => !toolNames.has(toolName));

    if (missingTools.length > 0) {
      throw new Error(
        `MCP server is missing required tool(s): ${missingTools.join(", ")}`,
      );
    }

    return toolNames;
  }

  async function callTextTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const result = await client.callTool({ name, arguments: args });
    const text = getTextContent(result.content as ReadonlyArray<TextContentBlock>);

    if (result.isError) {
      throw new Error(text || `MCP tool failed: ${name}`);
    }

    return text;
  }

  async function close(): Promise<void> {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }

  return {
    configPath,
    serverName,
    mcpUrl,
    health,
    listTools,
    ensureTools,
    callTextTool,
    close,
  };
}