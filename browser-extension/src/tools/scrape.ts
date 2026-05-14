import {
  acceptCookieBanner,
  waitForDomStable,
  showErrorBorder,
  showAutomationBorder,
  hideAutomationBorder,
} from "../lib/content-script/tools";
import { waitForTabLoad, waitForContentScript, createWebTab } from "../lib/worker/tools";
import type { WorkItem, WorkItemResult, McpToolMeta } from "../types";
import type { WorkItemTool } from "../lib/worker/work-item-scheduler";
import type { ContentScriptTool } from "../lib/content-script/tool-registry";

// ---------------------------------------------------------------------------
// Payload / Result types
// ---------------------------------------------------------------------------

export interface ScrapePayload {
  /** The URL to scrape */
  url: string;
  /** Output format: 'html' (cleaned HTML), 'md' (Markdown), 'json' (structured). Default: 'html' */
  format?: "html" | "json" | "md";
  /** Include debug info in response. Default: false */
  debug?: boolean;
  /** Whether to close the tab after scraping. Default: true */
  closeTab?: boolean;
}

/** Full HTML of the scraped page */
export type ScrapeResult = string;

/** MCP metadata for auto-discovery */
export const mcpMeta: McpToolMeta = {
  workItemType: "scrape",
  name: "scrape",
  description:
    "Open a browser tab, navigate to the given URL, wait for the page to fully load, and return the page content. Output is cleaned via Defuddle. Use format='html' for cleaned HTML, 'md' for Markdown, or 'json' for structured output with metadata.",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL to scrape, e.g. 'https://example.com'",
      },
      format: {
        type: "string",
        description: "Output format: 'html' (cleaned HTML), 'md' (Markdown with metadata), 'json' (structured JSON with metadata). Default: 'html'",
        default: "html",
      },
      debug: {
        type: "boolean",
        description: "Include debug info in response. Default: false",
        default: false,
      },
      closeTab: {
        type: "boolean",
        description: "Whether to close the tab after scraping. Default: true",
        default: true,
      },
    },
    required: ["url"],
  },
};

// ---------------------------------------------------------------------------
// Worker-side tool
// ---------------------------------------------------------------------------

export const ScrapeWorkerTool: WorkItemTool<ScrapePayload, ScrapeResult> = {
  type: "scrape",

  async executeInWorker(
    item: WorkItem<ScrapePayload>,
  ): Promise<WorkItemResult<ScrapeResult>> {
    let tabId: number | undefined;
    try {
      const focusTab = item.options?.focusAutomation ?? true;
      const { tabId: newTabId } = await createWebTab(item.payload.url, focusTab);
      tabId = newTabId;


      // Wait for the page to fully load
      await waitForTabLoad(tabId);

      // Wait for the content script to initialise its RPC listener
      const rpc = await waitForContentScript(tabId);
      const result = (await rpc.TabRpc.executeTool("scrape", {})) as WorkItemResult<ScrapeResult>;

      // Close tab unless debug mode or closeTab is false
      const shouldClose = item.options?.closeTab ?? true;
      if (result.success && !item.debug && shouldClose) {
        chrome.tabs.remove(tabId).catch(() => { });
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
// Content-script-side tool
// ---------------------------------------------------------------------------

async function executeScrape(_data: Record<string, never>): Promise<WorkItemResult<ScrapeResult>> {
  try {
    await showAutomationBorder();

    // Try to dismiss cookie consent banners
    await acceptCookieBanner();

    // Wait for the DOM to stabilize after page load
    await waitForDomStable({
      selector: "body",
      quietPeriodMs: 1_000,
      timeoutMs: 3_000,
    });

    const html = document.documentElement.outerHTML;

    hideAutomationBorder();
    return { success: true, result: html };
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    showErrorBorder();
    return {
      success: false,
      error: { name: error.name, message: error.message, stack: error.stack },
    };
  }
}

export const ScrapeContentScriptTool: ContentScriptTool<
  Record<string, never>,
  ScrapeResult
> = {
  type: "scrape",
  execute: executeScrape,
};
