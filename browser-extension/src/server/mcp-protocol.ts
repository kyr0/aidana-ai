import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { allMcpTools } from "../mcp-tools.js";
import type { McpToolMeta } from "../types.js";
import { fileDelete, fileRead, fileWrite } from "./file-ops.js";
import { doWorkItem } from "./server.js";

export const mcpServerInfo = {
  name: "aidana-browser-extension",
  version: "0.0.1",
};

const toolsByName = new Map<string, McpToolMeta>(
  allMcpTools.map((tool) => [tool.name, tool]),
);

export function createMcpProtocolServer(): Server {
  const mcp = new Server(mcpServerInfo, { capabilities: { tools: {} } });

  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allMcpTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }));

  mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      if (name === "file_read") {
        const text = await fileRead((args as any).path);
        return { content: [{ type: "text", text }] };
      }

      if (name === "file_write") {
        await fileWrite((args as any).path, (args as any).content);
        return { content: [{ type: "text", text: "OK" }] };
      }

      if (name === "delete_file") {
        await fileDelete((args as any).path);
        return { content: [{ type: "text", text: "OK" }] };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `File tool error: ${message}` }],
        isError: true,
      };
    }

    const meta = toolsByName.get(name);
    if (!meta) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    try {
      const item = await doWorkItem({
        type: meta.workItemType,
        payload: args ?? {},
        options: { focusAutomation: true, closeTab: true },
      });

      const text =
        typeof item.result === "string"
          ? item.result
          : JSON.stringify(item.result, null, 2);

      return { content: [{ type: "text", text }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Tool error: ${message}` }],
        isError: true,
      };
    }
  });

  return mcp;
}