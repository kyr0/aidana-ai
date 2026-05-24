import {
  acceptCookieBanner,
  waitForSelector,
  waitForDomStable,
  showErrorBorder,
  showAutomationBorder,
  hideAutomationBorder,
} from "../lib/content-script/tools";
import { waitForTabLoad, waitForContentScript, createWebTab } from "../lib/worker/tools";
import type { WorkItem, WorkItemResult, McpToolMeta } from "../types";
import type { WorkItemTool } from "../lib/worker/work-item-scheduler";
import type { ContentScriptTool } from "../lib/content-script/tool-registry";

export interface GoogleSearchPayload {
  query: string;
  topK?: number;
  /** Whether to wait for and include Google's AI summary (default: false) */
  aiSummary?: boolean;
}

export interface GoogleSearchLink {
  title: string;
  url: string;
}

export interface GoogleSearchResult {
  links: GoogleSearchLink[];
  aiSummary?: string;
  /** Raw HTML of all Google knowledge panels (`.kp-wholepage-osrp`), joined with \n\n */
  kpHtml?: string;
  /** Raw HTML of weather widget (`[data-entityname="Weather"]`) if available */
  weather?: string;
  /** Raw HTML of travel info widget (`[data-attrid="TravelGettingThereFeedback"]`) if available */
  travelInfo?: string;
}

/** MCP metadata for auto-discovery */
export const mcpMeta: McpToolMeta = {
  workItemType: "google_search",
  name: "google_search",
  description:
    "Search Google and return top results as Markdown. Optionally includes Google's AI summary.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query" },
      topK: {
        type: "number",
        description: "Number of top results to return (default: 3)",
        default: 3,
      },
      aiSummary: {
        type: "boolean",
        description:
          "Whether to wait for and include Google's AI summary (default: false)",
        default: false,
      },
    },
    required: ["query"],
  },
};

/**
 * Worker-side tool that opens a Google Search tab and delegates
 * DOM extraction to the content script running in that tab.
 */
export const GoogleSearchWorkerTool: WorkItemTool<GoogleSearchPayload, GoogleSearchResult> =
{
  type: "google_search",

  async executeInWorker(
    item: WorkItem<GoogleSearchPayload>,
  ): Promise<WorkItemResult<GoogleSearchResult>> {
    const { query, topK } = item.payload;
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

    let tabId: number | undefined;
    try {
      // Open the search tab (focused by default unless options say otherwise)
      const focusTab = item.options?.focusAutomation ?? true;
      const { tabId: newTabId } = await createWebTab(url, focusTab);
      tabId = newTabId;

      // Wait for the page to fully load
      await waitForTabLoad(tabId);

      // Wait for the content script to initialise its RPC listener
      const rpc = await waitForContentScript(tabId);
      const result = (await rpc.TabRpc.executeTool("google_search", {
        topK: topK ?? 3,
        aiSummary: item.payload.aiSummary,
      })) as WorkItemResult<GoogleSearchResult>;

      // Close tab unless debug mode, closeTab is false, or the search failed
      const shouldClose = item.options?.closeTab ?? true;
      if (result.success && !item.debug && shouldClose) {
        chrome.tabs.remove(tabId).catch(() => { });
      }

      return result;
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      // Leave tab open on error for diagnostics
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

// --- Content-script-side executor (runs in tab's isolated world) ---

/**
 * Execute Google Search DOM extraction inside the tab's content-script context.
 */
async function executeGoogleSearch(data: {
  topK?: number;
  aiSummary?: boolean;
}): Promise<WorkItemResult<GoogleSearchResult>> {
  try {
    const { topK = 3, aiSummary = false } = data;

    // Signal that this tab is being automated
    await showAutomationBorder();

    // Try to dismiss cookie consent banners
    await acceptCookieBanner();

    // Wait for either answer box or organic results
    await waitForSelector(
      ['[data-spe="true"]', '[data-subtree="aimc"]', "[data-rpos]"],
      10_000,
    );

    let aiSummaryText: string | undefined;

    if (aiSummary) {
      await waitForDomStable({
        selector: '[data-subtree="aimc"], [data-spe="true"]',
        quietPeriodMs: 500,
        timeoutMs: 10_000,
      });

      const aiSummaryContent =
        document.querySelector('[data-subtree="aimc"]') ??
        document.querySelector('[data-spe="true"]');

      if (aiSummaryContent) {
        aiSummaryText = (aiSummaryContent as HTMLElement).innerText;
      }
    }

    // Extract knowledge panel raw HTML (processed server-side with Defuddle)
    // .kp-wholepage-osrp can exist multiple times — combine all with \n\n
    // The KP loads lazily — wait for it to be fully populated.
    let kpHtml: string | undefined;
    const kpElements = document.querySelectorAll(".kp-wholepage-osrp");
    if (kpElements.length > 0) {
      await waitForDomStable({
        selector: ".kp-wholepage-osrp",
        quietPeriodMs: 500,
        timeoutMs: 5_000,
      });
      kpHtml = Array.from(kpElements)
        .map((el) => el.innerHTML)
        .join("\n\n");
    }

    // Extract weather widget
    let weather: string | undefined;
    const weatherElement = document.querySelector('[data-entityname="Weather"]');
    if (weatherElement) {
      weather = weatherElement.innerHTML;
    }

    // Extract travel info widget
    let travelInfo: string | undefined;
    const travelElement = document.querySelector('[data-attrid="TravelGettingThereFeedback"]');
    if (travelElement) {
      travelInfo = travelElement.innerHTML;
    }

    // Extract all links from organic results, deduplicated
    const linkElements = Array.from(document.querySelectorAll('[data-rpos] [jsaction] a[jsname]'));
    const seen = new Set<string>();
    const links: GoogleSearchLink[] = [];
    for (const el of linkElements) {
      const href = el.getAttribute("href");
      const title = el.textContent?.trim() ?? "";
      if (!href || !title || seen.has(href)) continue;
      seen.add(href);
      links.push({ title, url: href });
    }

    const result: GoogleSearchResult = {
      links: links.slice(0, topK),
    };
    if (aiSummaryText) result.aiSummary = aiSummaryText;
    if (kpHtml) result.kpHtml = kpHtml;
    if (weather) result.weather = weather;
    if (travelInfo) result.travelInfo = travelInfo;

    hideAutomationBorder();
    return { success: true, result };
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    showErrorBorder();
    return {
      success: false,
      error: { name: error.name, message: error.message, stack: error.stack },
    };
  }
}

/** Content-script-side tool registration for Google Search */
export const GoogleSearchContentScriptTool: ContentScriptTool<
  { topK?: number; aiSummary?: boolean },
  GoogleSearchResult
> = {
  type: "google_search",
  execute: executeGoogleSearch,
};
