import {
  createServer,
  type IncomingMessage,
  type Server as NodeHttpServer,
  type ServerResponse,
} from "node:http";
import { createRpcServer, rpcRoute } from "defuss-rpc/server.js";
import type { WorkItem, WorkItemResult } from "../types.js";
import {
  enqueueWorkItem,
  doWorkItem,
  observeWorkItem,
  completeWorkItem,
  claimWorkItems,
} from "./work-orchestration.js";
import {
  getWorkspacePath,
  setWorkspacePath,
} from "./file-ops.js";
import { runtimeConfig } from "./runtime-config.js";

export { enqueueWorkItem, doWorkItem, observeWorkItem };

// -- RPC API --
const WorkApi = {
  /** Claim all pending work items (atomically moves them to in-progress) */
  async claimWorkItems(): Promise<Array<WorkItem>> {
    return claimWorkItems();
  },

  /** Receive a processed work item result from the extension */
  async submitWorkItemResult(
    id: string,
    result: WorkItemResult,
  ): Promise<void> {
    completeWorkItem(id, result);
  },

  /** Enqueue a new work item (callable via RPC for external orchestration) */
  async enqueue(item: Omit<WorkItem, "id" | "status">): Promise<WorkItem> {
    return enqueueWorkItem(item);
  },

  /** Get the current workspace path used by file tools */
  async getWorkspacePath(): Promise<string> {
    return getWorkspacePath();
  },

  /** Update the workspace path (called by the extension worker on pref change) */
  async setWorkspacePath(path: string): Promise<void> {
    setWorkspacePath(path);
  },

  /** List directory contents at an absolute path (for the directory browser UI) */
  async listDirectory(
    path: string,
  ): Promise<Array<{ name: string; isDirectory: boolean }>> {
    const { listDirectory } = await import("./file-ops.js");
    return listDirectory(path);
  },
};

export const RpcApi = { JobApi: WorkApi };
createRpcServer(RpcApi);

export type ServerRpcApi = typeof RpcApi;

export const port = runtimeConfig.workQueuePort;

class WorkQueueServer {
  private readonly host = "127.0.0.1";
  private listener: NodeHttpServer | undefined;

  async start(): Promise<{ port: number; url: string }> {
    if (this.listener?.listening) {
      return { port, url: this.getUrl() };
    }

    const listener = createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      listener.once("error", reject);
      listener.listen(port, this.host, () => {
        listener.off("error", reject);
        resolve();
      });
    });

    this.listener = listener;
    console.log(`[work-queue] server running on ${this.getUrl()}`);
    return { port, url: this.getUrl() };
  }

  async stop(): Promise<void> {
    const listener = this.listener;
    if (!listener) return;

    this.listener = undefined;

    await new Promise<void>((resolve, reject) => {
      listener.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    console.log("[work-queue] server stopped");
  }

  getPort(): number {
    return port;
  }

  getUrl(): string {
    return `http://${this.host}:${port}`;
  }

  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    try {
      this.setCorsHeaders(res);

      if (req.method === "OPTIONS") {
        res.writeHead(200);
        res.end();
        return;
      }

      const requestUrl = new URL(req.url ?? "/", this.getUrl());
      const pathname = requestUrl.pathname.replace(/\/+$/, "") || "/";

      if (pathname === "/health") {
        this.sendJson(res, 200, {
          status: "ok",
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (pathname !== "/rpc" && pathname !== "/rpc/schema") {
        this.sendJson(res, 404, { error: "Not found" });
        return;
      }

      const requestBody = await this.readBody(req);
      const response = await rpcRoute({
        request: new Request(requestUrl, {
          method: req.method,
          headers: this.toRequestHeaders(req),
          body:
            req.method !== "GET" && req.method !== "HEAD" && requestBody
              ? requestBody
              : undefined,
        }),
      });

      await this.writeFetchResponse(res, response);
    } catch (error) {
      console.error("[work-queue] request error", error);
      this.sendJson(res, 500, {
        error: "Internal server error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private setCorsHeaders(res: ServerResponse): void {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization, Content-Encoding",
    );
  }

  private sendJson(res: ServerResponse, status: number, body: unknown): void {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
  }

  private toRequestHeaders(req: IncomingMessage): Headers {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          headers.append(key, item);
        }
      } else if (typeof value === "string") {
        headers.set(key, value);
      }
    }
    return headers;
  }

  private async readBody(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];

    for await (const chunk of req) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }

    return Buffer.concat(chunks).toString("utf-8");
  }

  private async writeFetchResponse(
    res: ServerResponse,
    response: Response,
  ): Promise<void> {
    res.statusCode = response.status;

    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    if (!response.body) {
      res.end();
      return;
    }

    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  }
}

export const server = new WorkQueueServer();
