import {
  showErrorBorder,
  showAutomationBorder,
  hideAutomationBorder,
} from "../lib/content-script/tools";
import { htmlToMarkdown } from "../lib/content-script/html-to-markdown";
import { press } from "../lib/content-script/synthetic-events";
import { waitForTabLoad, waitForContentScript, createWebTab } from "../lib/worker/tools";
import type { WorkItem, WorkItemResult, McpToolMeta } from "../types";
import type { WorkItemTool } from "../lib/worker/work-item-scheduler";
import type { ContentScriptTool } from "../lib/content-script/tool-registry";

// ---------------------------------------------------------------------------
// Payload / Result types
// ---------------------------------------------------------------------------

export interface GoogleMapsPayload {
  /** Search query for Google Maps, e.g. "restaurants in Berlin" */
  query: string;
}

/** A point of interest extracted from Google Maps */
export interface GoogleMapsPOI {
  name: string;
  markdown: string;
}

export interface GoogleMapsResult {
  pois?: GoogleMapsPOI[];
  location?: string;
}

/** MCP metadata for auto-discovery */
export const mcpMeta: McpToolMeta = {
  workItemType: "google_maps",
  name: "google_maps",
  description:
    "Search Google Maps for points of interest at a given location and return a list of results with Markdown content.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query for Google Maps, e.g. 'restaurants in Berlin'",
      },
      closeTab: {
        type: "boolean",
        description: "Whether to close the tab after execution. Default: true",
        default: true,
      },
    },
    required: ["query"],
  },
};

// ---------------------------------------------------------------------------
// Worker-side tool
// ---------------------------------------------------------------------------
// Two-phase approach:
//   Phase 1 — Content script types query, presses Enter, waits for results.
//   Phase 2 — Worker reloads the tab (stable DOM), then extracts POIs.
// ---------------------------------------------------------------------------

export const GoogleMapsWorkerTool: WorkItemTool<GoogleMapsPayload, GoogleMapsResult> = {
  type: "google_maps",

  async executeInWorker(
    item: WorkItem<GoogleMapsPayload>,
  ): Promise<WorkItemResult<GoogleMapsResult>> {
    const { query } = item.payload;
    const url = "https://www.google.com/maps";

    let tabId: number | undefined;
    try {
      const focusTab = item.options?.focusAutomation ?? true;
      const { tabId: newTabId } = await createWebTab(url, focusTab);
      tabId = newTabId;

      // --- Phase 1: Type query, press Enter (returns immediately) ---
      await waitForTabLoad(tabId);
      const rpc = await waitForContentScript(tabId);
      const sendResult = await rpc.TabRpc.executeTool("google_maps_send", { query });
      if (!sendResult.success) {
        return sendResult as WorkItemResult<GoogleMapsResult>;
      }

      // Wait for the URL to actually change (SPA navigation after Enter).
      // Google Maps is a SPA — the URL updates after a short delay.
      const preUrl = (await chrome.tabs.get(tabId)).url;
      let searchUrl = preUrl;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const tab = await chrome.tabs.get(tabId);
        if (tab.url && tab.url !== preUrl) {
          searchUrl = tab.url;
          break;
        }
      }

      if (searchUrl === preUrl) {
        // URL didn't change — use current tab URL anyway
        const tab = await chrome.tabs.get(tabId);
        searchUrl = tab.url ?? preUrl;
      }
      if (!searchUrl) {
        return {
          success: false,
          error: { name: "NoUrl", message: "Could not read tab URL after search" },
        };
      }

      // --- Phase 2: Reload to get stable DOM, then extract ---
      await chrome.tabs.update(tabId, { url: searchUrl });
      await waitForTabLoad(tabId);
      const rpc2 = await waitForContentScript(tabId);
      const result = (await rpc2.TabRpc.executeTool("google_maps_extract", {})) as WorkItemResult<GoogleMapsResult>;

      const shouldClose = item.options?.closeTab ?? true;
      if (result.success && !item.debug && shouldClose) {
        setTimeout(() => chrome.tabs.remove(tabId).catch(() => {}), 1000);
      }

      return result;
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      return {
        success: false,
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Content-script-side tools
// ---------------------------------------------------------------------------

/** Wait for a CSS selector to appear in the DOM */
function waitForElement(selector: string, timeoutMs = 10_000): Promise<Element | null> {
  return new Promise((resolve) => {
    const existing = document.querySelector(selector);
    if (existing) {
      resolve(existing);
      return;
    }

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);
  });
}

// --- google_maps_send: type query, press Enter, wait for results ---

async function executeGoogleMapsSend(data: { query: string }): Promise<WorkItemResult<void>> {
  try {
    const { query } = data;

    await showAutomationBorder();

    // 1. Find search input
    const searchInput = (await waitForElement('[name="q"][role="combobox"]', 10_000)) as HTMLInputElement | null;
    if (!searchInput) {
      showErrorBorder();
      return {
        success: false,
        error: { name: "ElementNotFound", message: "Search input not found" },
      };
    }

    // Type query
    searchInput.focus();
    searchInput.value = query;
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    searchInput.dispatchEvent(new Event("change", { bubbles: true }));

    // 2. Press Enter to submit — return immediately.
    // DO NOT wait for articles here. Waiting causes the content script to still be
    // pending when Chrome bfcaches the page, killing the RPC port.
    // The worker will wait for the URL to update and tab to load after this returns.
    await press(searchInput, "Enter");

    return { success: true };
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    showErrorBorder();
    return {
      success: false,
      error: { name: error.name, message: error.message, stack: error.stack },
    };
  }
}

// --- google_maps_extract: read POIs from stable DOM ---

async function executeGoogleMapsExtract(
  _data: Record<string, never>,
): Promise<WorkItemResult<GoogleMapsResult>> {
  try {
    // Race: whichever appears first — articles or main — we use it.
    // This avoids waiting 15s for articles when main is already there.
    type RaceResult = { type: "article" } | { type: "main" };

    const race = new Promise<RaceResult>((resolve, reject) => {
      let resolved = false;

      const cleanup = () => {
        ao.disconnect();
        mo.disconnect();
        clearTimeout(timeout);
      };

      const finish = (result: RaceResult) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve(result);
        }
      };

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for articles or main content"));
      }, 15_000);

      // Check if either already exists
      const existingArticle = document.querySelector('[role="article"]');
      const existingMain = document.querySelector('[role="main"]');
      if (existingArticle) {
        return finish({ type: "article" });
      }
      if (existingMain) {
        return finish({ type: "main" });
      }

      const ao = new MutationObserver(() => {
        if (document.querySelector('[role="article"]')) {
          finish({ type: "article" });
        }
      });

      const mo = new MutationObserver(() => {
        if (document.querySelector('[role="main"]')) {
          finish({ type: "main" });
        }
      });

      ao.observe(document.body, { childList: true, subtree: true });
      mo.observe(document.body, { childList: true, subtree: true });
    });

    const { type } = await race;

    if (type === "article") {
      const allArticles = Array.from(document.querySelectorAll('[role="article"]'));
      const pois: GoogleMapsPOI[] = [];
      for (const article of allArticles) {
        const name = article.getAttribute("aria-label");
        if (!name) continue;
        const markdown = htmlToMarkdown(article);
        pois.push({ name, markdown });
      }
      return { success: true, result: { pois } };
    }

    // main — extract as location (not POI list)
    const main = document.querySelector('[role="main"]');
    if (!main) {
      return {
        success: false,
        error: { name: "NoResults", message: "No main content found" },
      };
    }
    const location = htmlToMarkdown(main);
    return { success: true, result: { location } };
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    return {
      success: false,
      error: { name: error.name, message: error.message, stack: error.stack },
    };
  }
}

/** Content-script-side tool registrations for Google Maps */
export const GoogleMapsSendContentScriptTool: ContentScriptTool<
  { query: string },
  void
> = {
  type: "google_maps_send",
  execute: executeGoogleMapsSend,
};

export const GoogleMapsExtractContentScriptTool: ContentScriptTool<
  Record<string, never>,
  GoogleMapsResult
> = {
  type: "google_maps_extract",
  execute: executeGoogleMapsExtract,
};
