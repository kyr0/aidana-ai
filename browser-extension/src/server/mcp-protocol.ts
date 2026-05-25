import { cp, mkdir } from "node:fs/promises";
import { basename, extname } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { allMcpTools } from "../mcp-tools.js";
import type { McpToolMeta } from "../types.js";
import {
  getWorkspacePath,
  memoryListFiles,
  memoryFileRead,
  memoryFileSave,
  memoryFileArchive,
  memorySearch,
  memoryFileAppend,
  memoryFileMeta,
} from "./file-ops.js";
import { doWorkItem } from "./server.js";

export const mcpServerInfo = {
  name: "aidana-browser-extension",
  version: "0.0.1",
};

const toolsByName = new Map<string, McpToolMeta>(
  allMcpTools.map((tool) => [tool.name, tool]),
);

export function createMcpProtocolServer(): Server {
  const mcp = new Server(mcpServerInfo, { capabilities: { tools: {} } });

  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allMcpTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }));

  mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      // -- Memory tools --
      if (name === "memory_list_files") {
        const tree = await memoryListFiles();
        return { content: [{ type: "text", text: tree }] };
      }

      if (name === "memory_file_read") {
        const text = await memoryFileRead((args as any).name);
        return { content: [{ type: "text", text }] };
      }

      if (name === "memory_file_save") {
        await memoryFileSave(
          (args as any).name,
          (args as any).content,
          (args as any).fileType ?? "note",
          (args as any).summary,
          (args as any).keywords ?? [],
          (args as any).relatedTo ?? [],
        );
        return { content: [{ type: "text", text: `Memory '${(args as any).name}' saved.` }] };
      }

      if (name === "memory_file_archive") {
        await memoryFileArchive((args as any).name);
        return { content: [{ type: "text", text: `Memory '${(args as any).name}' archived.` }] };
      }

      if (name === "memory_search") {
        const results = await memorySearch((args as any).keywords ?? []);
        return { content: [{ type: "text", text: results }] };
      }

      if (name === "memory_file_append") {
        await memoryFileAppend((args as any).name, (args as any).content);
        return { content: [{ type: "text", text: `Appended to memory '${(args as any).name}'.` }] };
      }

      if (name === "memory_file_meta") {
        const meta = await memoryFileMeta((args as any).name);
        return { content: [{ type: "text", text: meta }] };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Memory tool error: ${message}` }],
        isError: true,
      };
    }

    // -- Scrape tool (with Defuddle processing) --
    if (name === "scrape") {
      try {
        // Normalize URL: ensure it has a protocol
        let url: string;
        try {
          url = new URL((args as any).url).toString();
        } catch {
          // If URL constructor fails (e.g. "spiegel.de"), prepend https://
          url = new URL(`https://${(args as any).url}`).toString();
        }
        const format = (args as any).format ?? "html";
        const debug = (args as any).debug ?? false;
        const closeTab = (args as any).closeTab ?? true;
        const dedup = (args as any).dedup ?? false;
        const mainTopicFocus = (args as any).mainTopicFocus;

        // Get raw HTML via browser automation
        const item = await doWorkItem({
          type: "scrape",
          payload: { url },
          options: { focusAutomation: true, closeTab },
        });

        // Process with Defuddle (all formats go through for cleanup)
        const { parseHTML } = await import("linkedom");
        const { Defuddle } = await import("defuddle/node");
        const { document } = parseHTML(item.result);
        const result = await Defuddle(document, url, {
          markdown: format === "md",
          debug,
        });

        // Build metadata
        const metadata: Record<string, unknown> = {
          title: result.title ?? "",
          url,
        };
        if (result.author) metadata.author = result.author;
        if (result.language) metadata.language = result.language;
        if (result.published) metadata.published = result.published;
        if (result.wordCount) metadata.wordCount = result.wordCount;

        // Only include metaTags if schemaOrgData is NOT present
        if (result.metaTags && !result.schemaOrgData) {
          const wantedNames = new Set([
            "author",
            "email",
            "fb:page_id",
            "twitter:account_id",
            "locale",
            "og:image",
            "og:description",
            "og:title",
          ]);
          const filtered = (result.metaTags as Array<{ name?: string; content?: string }>)
            .filter((tag) => tag.name && wantedNames.has(tag.name))
            .map((tag) => ({ name: tag.name!, content: tag.content ?? "" }));
          if (filtered.length > 0) {
            metadata.metaTags = filtered;
          }
        }

        if (result.schemaOrgData) metadata.schemaOrgData = result.schemaOrgData;
        if (debug && result.debug) metadata.debug = result.debug;

        // Resolve content based on format
        let content: string;
        if (format === "md") {
          content = result.contentMarkdown ?? result.content;
        } else if (format === "json") {
          content = result.content;
        } else {
          content = result.content;
        }

        // Apply LLM-based post-processing if requested (all formats)
        // Uses DIRECT mode for fast, no-thinking text transformation
        if (dedup || mainTopicFocus) {
          try {
            const { callLlm } = await import("../tools/llm.js");
            const parts: string[] = [];
            if (mainTopicFocus) {
              parts.push(`Extract and focus only on content related to: "${mainTopicFocus}". Ignore unrelated sections.`);
            }
            if (dedup) {
              parts.push("Remove repetitive, redundant, or duplicate content. Keep the output concise while preserving all unique information.");
            }
            parts.push("Return the processed content directly without preamble or explanation.");
            const llmPrompt = parts.join("\n") + "\n\nContent:\n" + content;
            const llmResult = await callLlm({
              prompt: llmPrompt,
              mode: "direct",
              enableThinking: false,
              maxTokens: 2048,
            });
            content = llmResult.text;
          } catch (llmErr) {
            // If LLM is unavailable, return original content with a note
            const llmError = llmErr instanceof Error ? llmErr.message : String(llmErr);
            content = `[Note: LLM post-processing failed: ${llmError}. Returning original content.]\n\n` + content;
          }
        }

        return { content: [{ type: "text", text: JSON.stringify({ content_type: format, metadata, content }, null, 2) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Scrape error: ${message}` }],
          isError: true,
        };
      }
    }

    // -- Download file tool --
    if (name === "download_file") {
      try {
        const url = (args as any).url;
        const fileName = (args as any).fileName;

        // Download via browser extension
        const item = await doWorkItem({
          type: "download_file",
          payload: { url, fileName },
          options: { focusAutomation: false, closeTab: false },
        });

        const downloadResult = item.result as {
          path: string;
          url: string;
          finalUrl?: string;
          bytesReceived: number;
          totalBytes: number;
        };

        // Move file into workspace/downloads/
        const workspacePath = getWorkspacePath();
        const downloadsDir = `${workspacePath}/downloads`;
        await mkdir(downloadsDir, { recursive: true });

        // Determine destination filename
        let destName: string;
        if (fileName) {
          destName = fileName;
        } else {
          // Extract from finalUrl or original URL
          const sourceUrl = downloadResult.finalUrl ?? downloadResult.url;
          destName = basename(sourceUrl.split("?")[0]);
        }

        // If no extension, try to infer from URL
        if (!extname(destName)) {
          const sourceUrl = downloadResult.finalUrl ?? downloadResult.url;
          const ext = extname(sourceUrl.split("?")[0]);
          if (ext) destName += ext;
          else destName += ".bin";
        }

        const destPath = `${downloadsDir}/${destName}`;

        // Copy from Chrome downloads to workspace
        await cp(downloadResult.path, destPath);

        const relativePath = `./downloads/${destName}`;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  content_type: "download",
                  localPath: relativePath,
                  fileName: destName,
                  bytesReceived: downloadResult.bytesReceived,
                  totalBytes: downloadResult.totalBytes,
                  sourceUrl: downloadResult.url,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Download error: ${message}` }],
          isError: true,
        };
      }
    }

    // -- Google Maps (no retry) --
    if (name === "google_maps") {
      try {
        const item = await doWorkItem({
          type: "google_maps",
          payload: { query: (args as any).query },
          options: { focusAutomation: true, closeTab: true, retry: false },
        });
        return { content: [{ type: "text", text: JSON.stringify(item.result, null, 2) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Google Maps error: ${message}` }],
          isError: true,
        };
      }
    }

    // -- Consensus (no retry) --
    if (name === "consensus") {
      try {
        const item = await doWorkItem({
          type: "consensus",
          payload: { query: (args as any).query },
          options: { focusAutomation: true, closeTab: true, retry: false },
        });
        return { content: [{ type: "text", text: JSON.stringify(item.result, null, 2) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Consensus error: ${message}` }],
          isError: true,
        };
      }
    }

    // -- Google Search (process kpHtml → info with Defuddle) --
    if (name === "google_search") {
      try {
        const item = await doWorkItem({
          type: "google_search",
          payload: {
            query: (args as any).query,
            topK: (args as any).topK,
            aiSummary: (args as any).aiSummary,
          },
          options: { focusAutomation: true, closeTab: true },
        });

        const raw = item.result as {
          links?: unknown[];
          aiSummary?: string;
          kpHtml?: string;
          weather?: string;
          travelInfo?: string;
        };
        const output: Record<string, unknown> = { links: raw.links ?? [] };
        if (raw.aiSummary) output.aiSummary = raw.aiSummary;

        // Helper: process raw HTML fragment through Defuddle → markdown
        const processHtml = async (html: string) => {
          const { parseHTML } = await import("linkedom");
          const { Defuddle } = await import("defuddle/node");
          const { document } = parseHTML("<html><body>" + html + "</body></html>");
          const defuddle = await Defuddle(document, "", { markdown: true });
          return defuddle.content ?? "";
        };

        if (raw.kpHtml) output.info = await processHtml(raw.kpHtml);
        if (raw.weather) output.weather = await processHtml(raw.weather);
        if (raw.travelInfo) output.travelInfo = await processHtml(raw.travelInfo);

        return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Google search error: ${message}` }],
          isError: true,
        };
      }
    }

    // -- Web Search (aggregate: google_search + sequential scrapes) --
    if (name === "web_search") {
      try {
        const query = (args as any).query;
        const topK = (args as any).topK ?? 3;
        const format = (args as any).format ?? "md";
        const closeTab = (args as any).closeTab ?? true;

        // Helper: wrap promise with a timeout (ms)
        const withTimeout = (ms: number, promise: Promise<unknown>) => {
          let timer: ReturnType<typeof setTimeout>;
          const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(new Error(`Timeout after ${ms}ms`));
            }, ms);
          });
          return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
        };

        // Step 1: Google search to get links (45s timeout)
        const searchItem = (await withTimeout(
          45_000,
          doWorkItem({
            type: "google_search",
            payload: { query, topK },
            options: { focusAutomation: true, closeTab },
          }),
        )) as { result?: { links?: Array<{ title: string; url: string }> } };

        const rawLinks = searchItem?.result?.links;
        const links: Array<{ title: string; url: string }> = Array.isArray(rawLinks) ? rawLinks : [];

        if (links.length === 0) {
          return {
            content: [{ type: "text", text: JSON.stringify({ query, results: [], errors: [{ error: "No search results found" }] }, null, 2) }],
          };
        }

        // Step 2: Scrape each link sequentially (each opens/closes its own tab)
        // 45s timeout per scrape with one retry on timeout
        const results: Array<{ title: string; url: string; content: string }> = [];
        const errors: Array<{ url: string; error: string }> = [];

        for (let i = 0; i < links.length; i++) {
          const link = links[i];
          try {
            const scrapeItem = (await withTimeout(
              45_000,
              doWorkItem({
                type: "scrape",
                payload: { url: link.url, format },
                options: { focusAutomation: true, closeTab: true },
              }),
            )) as { result?: string };
            results.push({
              title: link.title,
              url: link.url,
              content: scrapeItem?.result ?? "",
            });
          } catch (err: unknown) {
            // First attempt failed (likely timeout), retry once
            try {
              const scrapeItem = (await withTimeout(
                45_000,
                doWorkItem({
                  type: "scrape",
                  payload: { url: link.url, format },
                  options: { focusAutomation: true, closeTab: true },
                }),
              )) as { result?: string };
              results.push({
                title: link.title,
                url: link.url,
                content: scrapeItem?.result ?? "",
              });
            } catch (retryErr: unknown) {
              const message = err instanceof Error ? err.message : String(err);
              errors.push({ url: link.url, error: message });
            }
          }
        }

        const output = {
          query,
          results,
          errors,
        };

        return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Web search error: ${message}` }],
          isError: true,
        };
      }
    }

    // -- ChatGPT (long-running, no retry) --
    if (name === "chatgpt") {
      try {
        const item = await doWorkItem({
          type: "chatgpt",
          payload: {
            prompt: (args as any).prompt,
            timeoutMs: (args as any).timeoutMs,
          },
          options: { focusAutomation: true, closeTab: true, retry: false },
        });
        return { content: [{ type: "text", text: item.result }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `ChatGPT error: ${message}` }],
          isError: true,
        };
      }
    }

    // -- LLM tool (dual-mode: direct or proxied) --
    if (name === "llm") {
      try {
        const { callLlm } = await import("../tools/llm.js");
        const a = args as Record<string, unknown>;
        const llmResult = await callLlm({
          prompt: a.prompt as string,
          mode: a.mode as "direct" | "proxy" | "auto" | undefined,
          // Endpoint overrides
          endpoint: a.endpoint as string | undefined,
          apiKey: a.apiKey as string | undefined,
          model: a.model as string | undefined,
          // Generation hyperparameters
          temperature: a.temperature as number | undefined,
          maxTokens: a.maxTokens as number | undefined,
          topP: a.topP as number | undefined,
          topK: a.topK as number | undefined,
          seed: a.seed as number | undefined,
          presencePenalty: a.presencePenalty as number | undefined,
          frequencyPenalty: a.frequencyPenalty as number | undefined,
          repetitionPenalty: a.repetitionPenalty as number | undefined,
          // Reasoning
          enableThinking: a.enableThinking as boolean | undefined,
          // Advanced
          recursionDepth: a.recursionDepth as number | undefined,
          // Embedding (reserved)
          embeddingEndpoint: a.embeddingEndpoint as string | undefined,
          embeddingModel: a.embeddingModel as string | undefined,
          embeddingApiKey: a.embeddingApiKey as string | undefined,
          // NER / Relation / Rerank (reserved)
          nerModel: a.nerModel as string | undefined,
          relationModel: a.relationModel as string | undefined,
          rerankModel: a.rerankModel as string | undefined,
        });
        const output: Record<string, unknown> = { text: llmResult.text };
        if (llmResult.model) output.model = llmResult.model;
        if (llmResult.reasoningContent) output.reasoningContent = llmResult.reasoningContent;
        if (llmResult.usage) output.usage = llmResult.usage;
        return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `LLM error: ${message}` }],
          isError: true,
        };
      }
    }

    const meta = toolsByName.get(name);
    if (!meta) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    try {
      const item = await doWorkItem({
        type: meta.workItemType,
        payload: args ?? {},
        options: { focusAutomation: true, closeTab: true },
      });

      const text =
        typeof item.result === "string"
          ? item.result
          : JSON.stringify(item.result, null, 2);

      return { content: [{ type: "text", text }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Tool error: ${message}` }],
        isError: true,
      };
    }
  });

  return mcp;
}
