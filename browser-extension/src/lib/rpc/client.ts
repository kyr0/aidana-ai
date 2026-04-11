import { DSON } from "defuss-dson";
import type { RpcCallMessage, RpcResponse, RpcSchema } from "./types";

// -- Transport helpers --

/** Send an RPC message to the service worker */
function sendToWorker(message: RpcCallMessage): Promise<RpcResponse> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: RpcResponse) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

/** Send an RPC message to a specific tab's content script */
function sendToTab(
  tabId: number,
  message: RpcCallMessage,
): Promise<RpcResponse> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response: RpcResponse) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

/** Resolve "active" to the actual tab ID */
async function resolveTabId(tabId: number | "active"): Promise<number> {
  if (typeof tabId === "number") return tabId;
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!tab?.id) throw new Error("No active tab found");
  return tab.id;
}

// -- Proxy builder --

/**
 * Build a typed proxy object from a schema and a send function.
 * Returns `{ ClassName: { method(...args): Promise<result> } }`
 */
function buildProxy<T>(
  schemas: RpcSchema[],
  send: (msg: RpcCallMessage) => Promise<RpcResponse>,
): T {
  const proxy: Record<
    string,
    Record<string, (...args: any[]) => Promise<any>>
  > = {};

  for (const schema of schemas) {
    const methods: Record<string, (...args: any[]) => Promise<any>> = {};

    for (const methodName of schema.methods) {
      methods[methodName] = async (...args: unknown[]) => {
        const response = await send({
          action: "__rpc",
          className: schema.name,
          methodName,
          args: DSON.stringify(args),
        });
        if (!response.success) {
          throw new Error(response.error ?? "RPC call failed");
        }
        return response.result !== undefined
          ? DSON.parse(response.result)
          : undefined;
      };
    }

    proxy[schema.name] = methods;
  }

  return proxy as T;
}

async function requestSchema(
  send: (msg: RpcCallMessage) => Promise<RpcResponse>,
  className = "",
): Promise<RpcSchema[]> {
  const schemaResponse = await send({
    action: "__rpc_schema",
    className,
    methodName: "",
    args: DSON.stringify([]),
  });

  if (!schemaResponse.success || !schemaResponse.schema?.length) {
    const target = className ? ` for ${className}` : "";
    throw new Error(`Failed to fetch RPC schema${target}`);
  }

  return schemaResponse.schema;
}

/**
 * Create a typed RPC client that calls the service worker.
 * Uses chrome.runtime.sendMessage as transport.
 *
 * @example
 * ```ts
 * import type { WorkerRpcApi } from "../worker-rpc";
 * const rpc = await createWorkerRpcClient<{ WorkerRpc: WorkerRpcApi }>();
 * const val = await rpc.WorkerRpc.dbGet("key");
 * ```
 */
export async function createWorkerRpcClient<T>(
  className = "WorkerRpc",
): Promise<T> {
  const schemas = await requestSchema(sendToWorker, className);
  return buildProxy<T>(schemas, sendToWorker);
}

/**
 * Create a typed RPC client that calls a tab's content script.
 * Uses chrome.tabs.sendMessage as transport.
 *
 * @param tabId - Specific tab ID or "active" (default) for the current active tab
 *
 * @example
 * ```ts
 * import type { TabRpcApi } from "../tab-rpc";
 * const rpc = await createTabRpcClient<{ TabRpc: TabRpcApi }>();
 * await rpc.TabRpc.showAlert("Hello!");
 * ```
 */
export async function createTabRpcClient<T>(
  tabId: number | "active" = "active",
  className = "TabRpc",
): Promise<T> {
  const resolvedId = await resolveTabId(tabId);

  const schemas = await requestSchema(
    (msg) => sendToTab(resolvedId, msg),
    className,
  );

  return buildProxy<T>(schemas, (msg) =>
    sendToTab(resolvedId, msg),
  );
}
