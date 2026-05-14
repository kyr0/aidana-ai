import { dbGetValue, dbSetValue } from "./lib/worker/db";
import { getValue, setValue } from "./lib/worker/prefs";
import {
  getArrayBufferValue,
  setArrayBufferValue,
  removeBlobValue,
} from "./lib/worker/blob";
import { getServerRpc } from "./lib/worker/server-rpc";
import { createTabRpcClient } from "./lib/rpc";
import type { RpcMeta } from "./lib/rpc";
import type { WorkItem } from "./types";
import { DSON } from "defuss-dson";

const VOICE_AGENT_PAGE_PATH = "src/voice-agent/voice-agent.html";

export interface VoiceAgentWindowInfo {
  open: boolean;
  pageUrl: string;
  tabId: number | null;
  windowId: number | null;
  created?: boolean;
}

async function getVoiceAgentWindowInfo(): Promise<VoiceAgentWindowInfo> {
  const pageUrl = chrome.runtime.getURL(VOICE_AGENT_PAGE_PATH);
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((tab) => tab.url === pageUrl);

  return {
    open: !!existing,
    pageUrl,
    tabId: existing?.id ?? null,
    windowId: existing?.windowId ?? null,
  };
}

export async function openVoiceAgentWindow(): Promise<VoiceAgentWindowInfo> {
  const existing = await getVoiceAgentWindowInfo();

  if (existing.open && existing.windowId != null && existing.tabId != null) {
    await chrome.windows.update(existing.windowId, { focused: true });
    await chrome.tabs.update(existing.tabId, { active: true });
    return { ...existing, created: false };
  }

  const createdWindow = await chrome.windows.create({
    url: existing.pageUrl,
    type: "popup",
    focused: true,
    width: 1280,
    height: 880,
  });

  if (!createdWindow) {
    return { ...existing, created: false };
  }
  return {
    open: true,
    pageUrl: existing.pageUrl,
    tabId: createdWindow.tabs?.[0]?.id ?? null,
    windowId: createdWindow.id ?? null,
    created: true,
  };
}

/** Worker-side RPC methods callable from popup and content-script */
export const WorkerRpc = {
  async dbGet(key: string): Promise<string | undefined> {
    return dbGetValue(key);
  },

  async dbSet(key: string, value: string): Promise<number> {
    return dbSetValue(key, value);
  },

  async getPrefValue(key: string, local = true): Promise<unknown> {
    return getValue(key, undefined, local);
  },

  async setPrefValue(key: string, value: unknown, local = true): Promise<void> {
    await setValue(key, value, local);
  },

  async saveFile(name: string, data: ArrayBuffer): Promise<void> {
    await setArrayBufferValue(name, data);
  },

  async readFile(name: string): Promise<ArrayBuffer | undefined> {
    return getArrayBufferValue(name);
  },

  async deleteFile(name: string): Promise<void> {
    await removeBlobValue(name);
  },

  /** Claim pending work items from the server via defuss-rpc */
  async claimWorkItems(): Promise<WorkItem[]> {
    const rpc = await getServerRpc();
    return rpc.JobApi.claimWorkItems();
  },

  /** Push workspace path to the MCP server (called from popup on pref change) */
  async syncWorkspacePath(path: string): Promise<void> {
    await setValue("__defuss_agent_workspacePath", path, true);
    try {
      const rpc = await getServerRpc();
      await rpc.JobApi.setWorkspacePath(path);
    } catch {
      // server may not be running
    }
  },

  /** List directory contents via server (for the directory browser UI) */
  async listDirectory(
    path: string,
  ): Promise<Array<{ name: string; isDirectory: boolean }>> {
    const rpc = await getServerRpc();
    return rpc.JobApi.listDirectory(path);
  },

  async getVoiceAgentWindowInfo(): Promise<VoiceAgentWindowInfo> {
    return getVoiceAgentWindowInfo();
  },

  async openVoiceAgentWindow(): Promise<VoiceAgentWindowInfo> {
    return openVoiceAgentWindow();
  },

  /** Forward an RPC call to the active tab's content script */
  async tabRpcCall(
    className: string,
    methodName: string,
    ...args: unknown[]
  ): Promise<unknown> {
    const rpc =
      await createTabRpcClient<
        Record<string, Record<string, (...a: any[]) => any>>
      >();
    return rpc[className][methodName](...args);
  },

  /** Receive a captured DOM event from a tab's content script */
  async onCapturedEvent(
    type: string,
    detail: Record<string, unknown>,
    meta?: RpcMeta,
  ): Promise<void> {
    const tabId = meta?.sender?.tab?.id;
    console.log(
      `[worker] captured ${type} from tab ${tabId ?? "unknown"}:`,
      detail,
    );

    // Forward to popup (if open) — best-effort, ignore errors
    chrome.runtime
      .sendMessage({
        action: "__rpc",
        className: "PopupRpc",
        methodName: "onCapturedEvent",
        args: DSON.stringify([type, detail]),
      })
      .catch(() => {});
  },
};

export type WorkerRpcApi = typeof WorkerRpc;
