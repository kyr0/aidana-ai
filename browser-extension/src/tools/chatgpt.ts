import {
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

export interface ChatGPTPayload {
  /** The prompt to send to ChatGPT */
  prompt: string;
  /** Maximum time in ms to wait for generation (default: 180000 / 3 min) */
  timeoutMs?: number;
}

/** Text response from ChatGPT */
export type ChatGPTResult = string;

/** MCP metadata for auto-discovery */
export const mcpMeta: McpToolMeta = {
  workItemType: "chatgpt",
  name: "chatgpt",
  description:
    "Send a prompt to ChatGPT in the browser and await the full response. Requires the user to be logged into ChatGPT.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "The prompt to send to ChatGPT",
      },
      timeoutMs: {
        type: "number",
        description: "Maximum time in ms to wait for generation (default: 180000)",
        default: 180000,
      },
      closeTab: {
        type: "boolean",
        description: "Whether to close the tab after execution. Default: true",
        default: true,
      },
    },
    required: ["prompt"],
  },
};

// ---------------------------------------------------------------------------
// Worker-side tool
// ---------------------------------------------------------------------------
// Two-phase approach:
//   Phase 1 — Content script sends prompt, waits for generation to finish.
//   Phase 2 — Worker reloads the tab (DOM is now static), then extracts response.
// ---------------------------------------------------------------------------

export const ChatGPTWorkerTool: WorkItemTool<ChatGPTPayload, ChatGPTResult> = {
  type: "chatgpt",

  async executeInWorker(
    item: WorkItem<ChatGPTPayload>,
  ): Promise<WorkItemResult<ChatGPTResult>> {
    const { prompt, timeoutMs } = item.payload;
    const targetUrl = "https://chatgpt.com";

    let tabId: number | undefined;
    try {
      const focusTab = item.options?.focusAutomation ?? true;
      const { tabId: newTabId } = await createWebTab(targetUrl, focusTab);
      tabId = newTabId;

      // --- Phase 1: Send prompt and wait for generation to complete ---
      await waitForTabLoad(tabId);
      const rpc = await waitForContentScript(tabId);
      await rpc.TabRpc.executeTool("chatgpt_send", {
        prompt,
        timeoutMs: timeoutMs ?? 180_000,
      });

      // Capture the conversation URL (e.g. https://chatgpt.com/c/xxx)
      const tab = await chrome.tabs.get(tabId);
      const conversationUrl = tab.url;
      if (!conversationUrl) {
        return {
          success: false,
          error: { name: "NoUrl", message: "Could not read tab URL after sending" },
        };
      }

      // --- Phase 2: Navigate to conversation URL (static DOM), then extract ---
      await chrome.tabs.update(tabId, { url: conversationUrl });
      await waitForTabLoad(tabId);
      const rpc2 = await waitForContentScript(tabId);
      const result = (await rpc2.TabRpc.executeTool("chatgpt_extract", {})) as WorkItemResult<ChatGPTResult>;

      // Close tab unless debug mode (with 1s delay after execution)
      const shouldClose = item.options?.closeTab ?? true;
      if (result.success && !item.debug && shouldClose && tabId !== undefined) {
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
  return new Promise((resolve, reject) => {
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
      reject(new Error(`Element "${selector}" not found within ${timeoutMs}ms`));
    }, timeoutMs);
  });
}

// --- chatgpt_send: type prompt, click send, wait for generation to finish ---

async function executeChatGPTSend(data: {
  prompt: string;
  timeoutMs?: number;
}): Promise<WorkItemResult<void>> {
  try {
    const { prompt, timeoutMs = 180_000 } = data;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    await showAutomationBorder();

    // 1. Find the prompt input
    const input = (await waitForElement("#prompt-textarea", 15_000)) as HTMLElement | null;
    if (!input) {
      showErrorBorder();
      return {
        success: false,
        error: { name: "ElementNotFound", message: "Could not find #prompt-textarea" },
      };
    }

    // 2. Focus, clear, and type the prompt
    input.focus();
    input.click();
    await sleep(200);
    input.innerHTML = "";
    document.execCommand("insertText", false, prompt);
    await sleep(500);

    // 3. Click send button
    const sendBtn = await waitForElement('button[data-testid="send-button"]', 5_000) as HTMLButtonElement | null;
    if (!sendBtn || sendBtn.disabled) {
      showErrorBorder();
      return {
        success: false,
        error: { name: "SendButtonUnavailable", message: "Send button not found or disabled" },
      };
    }
    sendBtn.click();

    // 4. Wait for generation to complete — pure MutationObserver, no polling.
    //    Step A: wait for stop button to appear (generation started).
    //    Step B: wait for stop button to disappear + assistant message to appear.
    await waitForElement('button[data-testid="stop-button"]', timeoutMs);

    await new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        const stopBtn = document.querySelector('button[data-testid="stop-button"]');
        if (stopBtn) return; // still generating
        const assistantMessages = document.querySelectorAll('[data-message-author-role="assistant"]');
        if (assistantMessages.length > 0) {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });

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

// --- chatgpt_extract: read the latest assistant response from static DOM ---

async function executeChatGPTExtract(
  _data: Record<string, never>,
): Promise<WorkItemResult<ChatGPTResult>> {
  try {
    // ChatGPT is a SPA — after navigation the DOM is empty until JS renders.
    // Wait for the prose element to appear using MutationObserver.
    const proseElement = await waitForElement(".markdown.prose", 15_000) as HTMLElement | null;
    if (!proseElement) {
      return {
        success: false,
        error: { name: "NoResponse", message: "No prose element found in assistant message" },
      };
    }

    return { success: true, result: proseElement.innerText };
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    return {
      success: false,
      error: { name: error.name, message: error.message, stack: error.stack },
    };
  }
}

/** Content-script-side tool registrations for ChatGPT */
export const ChatGPTSendContentScriptTool: ContentScriptTool<
  { prompt: string; timeoutMs?: number },
  void
> = {
  type: "chatgpt_send",
  execute: executeChatGPTSend,
};

export const ChatGPTExtractContentScriptTool: ContentScriptTool<
  Record<string, never>,
  ChatGPTResult
> = {
  type: "chatgpt_extract",
  execute: executeChatGPTExtract,
};
