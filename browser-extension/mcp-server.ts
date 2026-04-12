/**
 * MCP Server for the defuss browser extension.
 *
 * Exposes every browser-extension tool to LLMs via the Model Context Protocol.
 * Under the hood it also starts the same HTTP work-queue server that the
 * browser extension polls and delegates each MCP tool call to `doWorkItem`.
 *
 * Run with:
 *   bun run mcp                        (stdio mode, default)
 *   AIDANA_MCP_TRANSPORT=http bun run mcp
 */

// MCP stdio uses stdout for the JSON-RPC protocol — redirect console.log
// so that RPC and transport logs never pollute protocol output.
console.log = console.error;

import { randomUUID } from "node:crypto";
import type { Server as NodeHttpServer } from "node:http";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { createMcpProtocolServer } from "./src/server/mcp-protocol.js";
import { runtimeConfig } from "./src/server/runtime-config.js";
import { server as workQueueServer } from "./src/server/server.js";

type HttpSession = {
  server: Server;
  transport: StreamableHTTPServerTransport;
};

type HttpTransportRequest = Parameters<
  StreamableHTTPServerTransport["handleRequest"]
>[0];

type HttpTransportResponse = Parameters<
  StreamableHTTPServerTransport["handleRequest"]
>[1];

type HttpRouteRequest = {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
};

type HttpRouteResponse = {
  headersSent: boolean;
  json(body: unknown): void;
  status(code: number): HttpRouteResponse;
};

let shuttingDown = false;
let activeStdioServer: Server | undefined;
let mcpHttpServer: NodeHttpServer | undefined;

const httpSessions = new Map<string, HttpSession>();

async function closeNodeServer(server?: NodeHttpServer): Promise<void> {
  if (!server) return;

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function closeHttpSessions(): Promise<void> {
  const sessions = Array.from(httpSessions.values());
  httpSessions.clear();

  await Promise.allSettled(sessions.map(({ server }) => server.close()));
}

async function shutdown(reason: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.error(`[mcp] shutting down (${reason})`);

  await Promise.allSettled([
    activeStdioServer?.close() ?? Promise.resolve(),
    closeHttpSessions(),
    closeNodeServer(mcpHttpServer),
    workQueueServer.stop(),
  ]);
}

function statusPayload() {
  return {
    ok: true,
    transport: runtimeConfig.mcpTransport,
    mcpPort: runtimeConfig.mcpPort,
    mcpPath: runtimeConfig.mcpPath,
    workQueuePort: runtimeConfig.workQueuePort,
    workspacePath: runtimeConfig.workspacePath,
  };
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function startHttpTransport(): Promise<void> {
  const app = createMcpExpressApp();

  app.get(runtimeConfig.healthPath, (_req: HttpRouteRequest, res: HttpRouteResponse) => {
    res.json(statusPayload());
  });

  app.all(runtimeConfig.mcpPath, async (req: HttpRouteRequest, res: HttpRouteResponse) => {
    try {
      const headerSessionId = firstHeaderValue(req.headers["mcp-session-id"]);
      let session = headerSessionId ? httpSessions.get(headerSessionId) : undefined;

      if (!session && req.method === "POST" && isInitializeRequest(req.body)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sessionId) => {
            if (session) {
              httpSessions.set(sessionId, session);
            }
          },
        });

        transport.onclose = () => {
          const sessionId = transport.sessionId;
          if (sessionId) {
            httpSessions.delete(sessionId);
          }
        };

        const server = createMcpProtocolServer();
        session = { server, transport };
        await server.connect(transport);
      }

      if (!session) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: No valid MCP session was provided",
          },
          id: null,
        });
        return;
      }

      await session.transport.handleRequest(
        req as unknown as HttpTransportRequest,
        res as unknown as HttpTransportResponse,
        req.body,
      );
    } catch (error) {
      console.error("[mcp] failed to handle HTTP request", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      }
    }
  });

  mcpHttpServer = await new Promise<NodeHttpServer>((resolve, reject) => {
    const server = app.listen(
      runtimeConfig.mcpPort,
      runtimeConfig.mcpHost,
      () => resolve(server),
    );
    server.once("error", reject);
  });

  console.error(
    `[mcp] ready transport=http endpoint=http://${runtimeConfig.mcpHost}:${runtimeConfig.mcpPort}${runtimeConfig.mcpPath} work-queue=${runtimeConfig.workQueueEndpoint}`,
  );
}

async function startStdioTransport(): Promise<void> {
  activeStdioServer = createMcpProtocolServer();

  const transport = new StdioServerTransport();
  transport.onclose = () => {
    void shutdown("transport closed");
  };

  process.stdin.on("end", () => {
    void shutdown("stdin closed");
  });

  await activeStdioServer.connect(transport);
  console.error(
    `[mcp] ready transport=stdio work-queue=${runtimeConfig.workQueueEndpoint}`,
  );
}

// -- Start ------------------------------------------------------------------
async function main(): Promise<void> {
  await workQueueServer.start();
  console.error(
    `[mcp] work-queue running on ${runtimeConfig.workQueueEndpoint} workspace=${runtimeConfig.workspacePath}`,
  );

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  if (runtimeConfig.mcpTransport === "http") {
    await startHttpTransport();
  } else {
    await startStdioTransport();
  }
}

main().catch((error) => {
  console.error("[mcp] fatal startup error", error);
  process.exitCode = 1;
});
