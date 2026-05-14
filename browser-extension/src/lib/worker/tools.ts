/** Shared utilities for worker-side tool implementations */

import { createTabRpcClient } from "../rpc";
import type { TabRpcApi } from "../../tab-rpc";

/**
 * Normalize a URL string to ensure it has a valid protocol.
 * If the input lacks a protocol (e.g. "spiegel.de"), prepends "https://".
 */
export function normalizeUrl(input: string): string {
  try {
    return new URL(input).toString();
  } catch {
    return new URL(`https://${input}`).toString();
  }
}

/**
 * Check if a tab's URL scheme is http or https.
 */
export function isHttpScheme(tab: chrome.tabs.Tab): boolean {
  const url = tab.url ?? "";
  return url.startsWith("http://") || url.startsWith("https://");
}

/**
 * Create a browser tab for a given URL, with automatic URL normalization.
 * If focusTab is true but the resulting tab is not an http(s) page,
 * it will not be focused to avoid showing chrome-extension:// URLs.
 */
export async function createWebTab(
  url: string,
  focusTab: boolean = true,
): Promise<{ tabId: number; tab: chrome.tabs.Tab }> {
  const normalized = normalizeUrl(url);
  const tab = await chrome.tabs.create({ url: normalized, active: false });

  if (tab.id === undefined) {
    throw new Error("chrome.tabs.create returned no tab ID");
  }

  // required, otherwise all browser automation stalls
  await chrome.tabs.update(tab.id, { active: true });

  return { tabId: tab.id, tab };
}

/** Wait for a tab to finish loading (status === "complete") */
export function waitForTabLoad(
  tabId: number,
  timeoutMs = 30_000,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(
        new Error(`Tab ${tabId} did not finish loading within ${timeoutMs}ms`),
      );
    }, timeoutMs);

    function listener(
      updatedTabId: number,
      changeInfo: chrome.tabs.OnUpdatedInfo,
    ) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

/**
 * Wait for the content script's RPC listener to be ready in a tab.
 *
 * After `waitForTabLoad` resolves the page is loaded, but the content
 * script (injected at `document_idle`) may not have registered its
 * `chrome.runtime.onMessage` listener yet. This helper retries the
 * RPC schema handshake until the content script responds.
 */
/**
 * Clear all cookies for a specific origin (e.g. "https://arztsuche.116117.de").
 * Uses chrome.cookies API to enumerate and remove each cookie individually,
 * which is more precise than browsingData (which only filters by time range).
 */
export async function clearCookies(origin: string): Promise<number> {
  const url = origin.endsWith("/") ? origin : `${origin}/`;
  const cookies = await chrome.cookies.getAll({ url });

  await Promise.all(
    cookies.map((cookie) => {
      const protocol = cookie.secure ? "https" : "http";
      const cookieUrl = `${protocol}://${cookie.domain.replace(/^\./, "")}${cookie.path}`;
      return chrome.cookies.remove({ url: cookieUrl, name: cookie.name });
    }),
  );

  console.log(`[worker] cleared ${cookies.length} cookie(s) for ${origin}`);
  return cookies.length;
}

/**
 * Clear localStorage, cacheStorage, and indexedDB for a specific origin.
 * Uses chrome.browsingData API — works from the service worker without a tab.
 * Note: sessionStorage is tab-scoped and cleared automatically when tabs close.
 * To clear sessionStorage in an open tab, use the MAIN-world clear_sessionstorage
 * postMessage command via the content script.
 */
export async function clearStorage(origin: string): Promise<void> {
  const normalizedOrigin = origin.replace(/\/$/, "");
  await chrome.browsingData.remove(
    { origins: [normalizedOrigin] },
    {
      localStorage: true,
      cacheStorage: true,
      indexedDB: true,
    },
  );
  console.log(`[worker] cleared storage for ${normalizedOrigin}`);
}

export async function waitForContentScript(
  tabId: number,
  {
    timeoutMs = 10_000,
    intervalMs = 500,
  }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<{ TabRpc: TabRpcApi }> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const rpc = await createTabRpcClient<{ TabRpc: TabRpcApi }>(tabId);
      return rpc;
    } catch {
      // Content script not ready yet — wait and retry
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  throw new Error(
    `Content script in tab ${tabId} did not respond within ${timeoutMs}ms`,
  );
}

export interface DownloadResult {
  id: number;
  path: string;
  url: string;
  finalUrl?: string;
  bytesReceived: number;
  totalBytes: number;
}

export interface DownloadOptions {
  filename?: string;
  saveAs?: boolean;
  timeoutMs?: number;
}

/**
 * Download a URL and resolve with the final absolute path on disk.
 *
 * Notes:
 * - `filename`, if provided, must be relative to Chrome's Downloads directory.
 * - Absolute paths and `..` are rejected by Chrome.
 * - Uses conflictAction: "overwrite".
 */
export async function downloadUrlToDisk(
  url: string,
  options: DownloadOptions = {},
): Promise<DownloadResult> {
  const {
    filename,
    saveAs = false,
    timeoutMs = 30 * 60 * 1000,
  } = options;

  if (!url || typeof url !== "string") {
    throw new TypeError("downloadUrlToDisk: url must be a non-empty string");
  }

  const downloadOptions: chrome.downloads.DownloadOptions = {
    url,
    conflictAction: "overwrite",
    saveAs,
  };

  if (filename) {
    downloadOptions.filename = filename;
  }

  return new Promise(async (resolve, reject) => {
    let downloadId: number | undefined;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const getDownloadItem = async (
      id: number,
    ): Promise<chrome.downloads.DownloadItem> => {
      const items = await chrome.downloads.search({ id });
      if (!items.length) {
        throw new Error(`Download item not found: ${id}`);
      }
      return items[0];
    };

    const cleanup = () => {
      clearTimeout(timeoutHandle);
      chrome.downloads.onChanged.removeListener(onChanged);
    };

    const resolveCompleted = async (id: number) => {
      try {
        const item = await getDownloadItem(id);
        if (item.state !== "complete") {
          return;
        }
        cleanup();
        resolve({
          id: item.id,
          path: item.filename!,
          url: item.url,
          finalUrl: item.finalUrl,
          bytesReceived: item.bytesReceived,
          totalBytes: item.totalBytes,
        });
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    const rejectInterrupted = async (id: number) => {
      try {
        const item = await getDownloadItem(id);
        cleanup();
        reject(
          new Error(
            `Download interrupted: ${item.error || "unknown error"}`,
          ),
        );
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    function onChanged(delta: chrome.downloads.DownloadDelta) {
      if (downloadId === undefined || delta.id !== downloadId) return;

      if (delta.state?.current === "complete") {
        resolveCompleted(delta.id);
      }

      if (delta.state?.current === "interrupted") {
        rejectInterrupted(delta.id);
      }
    }

    try {
      chrome.downloads.onChanged.addListener(onChanged);

      downloadId = await chrome.downloads.download(downloadOptions);

      timeoutHandle = setTimeout(async () => {
        cleanup();
        try {
          await chrome.downloads.cancel(downloadId!);
        } catch {
          // ignore cancel failure
        }
        reject(new Error(`Download timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      // Covers race where the download completes before onChanged fires.
      const item = await getDownloadItem(downloadId);

      if (item.state === "complete") {
        await resolveCompleted(downloadId);
      } else if (item.state === "interrupted") {
        await rejectInterrupted(downloadId);
      }
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}
