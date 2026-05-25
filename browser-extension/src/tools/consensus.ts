import {
  showErrorBorder,
  showAutomationBorder,
  hideAutomationBorder,
  waitForDomStable,
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

export interface ConsensusPayload {
  /** Natural language research query */
  query: string;
}

export interface ConsensusResult {
  markdown: string;
}

/** MCP metadata for auto-discovery */
export const mcpMeta: McpToolMeta = {
  workItemType: "consensus",
  name: "consensus",
  description:
    "Ask a research question on Consensus.app and return the AI-generated answer with paper summaries as Markdown.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Natural language research query, e.g. 'Does creatine improve cognitive performance?'",
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
//   Phase 1 — Content script types query, presses Enter, waits for div.prose to stabilize.
//   Phase 2 — Worker navigates to the stable URL, then extracts div.prose content.
// ---------------------------------------------------------------------------

export const ConsensusWorkerTool: WorkItemTool<ConsensusPayload, ConsensusResult> = {
  type: "consensus",

  async executeInWorker(
    item: WorkItem<ConsensusPayload>,
  ): Promise<WorkItemResult<ConsensusResult>> {
    const { query } = item.payload;
    const url = "https://consensus.app";

    let tabId: number | undefined;
    try {
      const focusTab = item.options?.focusAutomation ?? true;
      const { tabId: newTabId } = await createWebTab(url, focusTab);
      tabId = newTabId;

      // --- Phase 1: Type query, press Enter, wait for prose to stabilize ---
      await waitForTabLoad(tabId);
      const rpc = await waitForContentScript(tabId);
      const sendResult = await rpc.TabRpc.executeTool("consensus_send", { query });
      if (!sendResult.success) {
        return sendResult as WorkItemResult<ConsensusResult>;
      }

      // Capture the current URL (may have updated to a thread URL)
      const tab = await chrome.tabs.get(tabId);
      const threadUrl = tab.url;
      if (!threadUrl) {
        return {
          success: false,
          error: { name: "NoUrl", message: "Could not read tab URL after search" },
        };
      }

      // --- Phase 2: Navigate to stable URL, then extract ---
      await chrome.tabs.update(tabId, { url: threadUrl });
      await waitForTabLoad(tabId);
      const rpc2 = await waitForContentScript(tabId);
      const result = (await rpc2.TabRpc.executeTool("consensus_extract", {})) as WorkItemResult<ConsensusResult>;

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

// --- consensus_send: type query, press Enter, wait for prose ---

async function executeConsensusSend(data: { query: string }): Promise<WorkItemResult<void>> {
  try {
    const { query } = data;

    await showAutomationBorder();

    // 1. Find search input
    const input = (await waitForElement('[data-testid="new-thread-input"]', 10_000)) as HTMLTextAreaElement | null;
    if (!input) {
      showErrorBorder();
      return {
        success: false,
        error: { name: "ElementNotFound", message: 'Search input [data-testid="new-thread-input"] not found' },
      };
    }

    // Type query
    input.focus();
    input.value = query;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    // 2. Press Enter to submit
    await press(input, "Enter");

    // 3. Wait for div.prose to appear, then wait for it to stabilize
    const prose = await waitForElement("div.prose", 30_000);
    if (!prose) {
      showErrorBorder();
      return {
        success: false,
        error: { name: "NoResults", message: "No div.prose element found after submission" },
      };
    }

    // Wait for DOM to stabilize (content stops changing)
    await waitForDomStable({ target: prose, stabilityDuration: 2_000, maxWait: 30_000 });

    hideAutomationBorder();
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

// --- consensus_extract: read div.prose content ---

async function executeConsensusExtract(
  _data: Record<string, never>,
): Promise<WorkItemResult<ConsensusResult>> {
  try {
    // Wait for div.prose to appear (SPA may need time after navigation)
    const prose = await waitForElement("div.prose", 15_000);
    if (!prose) {
      return {
        success: false,
        error: { name: "NoResults", message: "No div.prose element found" },
      };
    }

    // Wait for DOM to stabilize
    await waitForDomStable({ target: prose, stabilityDuration: 1_000, maxWait: 15_000 });

    const markdown = htmlToMarkdown(prose);
    return { success: true, result: { markdown } };
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    return {
      success: false,
      error: { name: error.name, message: error.message, stack: error.stack },
    };
  }
}

/** Content-script-side tool registrations for Consensus */
export const ConsensusSendContentScriptTool: ContentScriptTool<
  { query: string },
  void
> = {
  type: "consensus_send",
  execute: executeConsensusSend,
};

export const ConsensusExtractContentScriptTool: ContentScriptTool<
  Record<string, never>,
  ConsensusResult
> = {
  type: "consensus_extract",
  execute: executeConsensusExtract,
};
