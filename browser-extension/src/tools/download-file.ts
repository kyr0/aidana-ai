import {
  showErrorBorder,
  showAutomationBorder,
  hideAutomationBorder,
} from "../lib/content-script/tools";
import {
  downloadUrlToDisk,
  type DownloadResult,
  waitForContentScript,
  createWebTab,
} from "../lib/worker/tools";
import type { WorkItem, WorkItemResult, McpToolMeta } from "../types";
import type { WorkItemTool } from "../lib/worker/work-item-scheduler";
import type { ContentScriptTool } from "../lib/content-script/tool-registry";

// ---------------------------------------------------------------------------
// Payload / Result types
// ---------------------------------------------------------------------------

export interface DownloadFilePayload {
  /** The URL to download */
  url: string;
  /** Optional filename (relative to Chrome's Downloads directory) */
  fileName?: string;
}

export type DownloadFileResult = DownloadResult;

/** MCP metadata for auto-discovery */
export const mcpMeta: McpToolMeta = {
  workItemType: "download_file",
  name: "download_file",
  description:
    "Download a file from the given URL using the browser's download API. Returns the local file path on disk. Optionally specify a custom filename.",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL to download, e.g. 'https://example.com/file.pdf'",
      },
      fileName: {
        type: "string",
        description: "Optional filename to use (relative to Downloads dir). If omitted, the server decides.",
      },
    },
    required: ["url"],
  },
};

// ---------------------------------------------------------------------------
// Worker-side tool
// ---------------------------------------------------------------------------

export const DownloadFileWorkerTool: WorkItemTool<
  DownloadFilePayload,
  DownloadFileResult
> = {
  type: "download_file",

  async executeInWorker(
    item: WorkItem<DownloadFilePayload>,
  ): Promise<WorkItemResult<DownloadFileResult>> {
    try {
      const result = await downloadUrlToDisk(item.payload.url, {
        filename: item.payload.fileName,
      });
      return { success: true, result };
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
// Content-script-side tool (no-op, download happens in worker)
// ---------------------------------------------------------------------------

async function executeDownloadFile(
  _data: Record<string, never>,
): Promise<WorkItemResult<DownloadFileResult>> {
  return { success: true, result: {} as DownloadFileResult };
}

export const DownloadFileContentScriptTool: ContentScriptTool<
  Record<string, never>,
  DownloadFileResult
> = {
  type: "download_file",
  execute: executeDownloadFile,
};
