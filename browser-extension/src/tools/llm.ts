import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { McpToolMeta } from "../types.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CONFIG_PATH = join(homedir(), ".aidana", "config.json");

interface RawConfig {
  llm?: {
    endpoint: string;
    apiKey: string;
    model: string;
    proxy?: {
      port: number;
    };
  };
}

interface LlmConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  proxyPort: number;
}

/**
 * Load LLM config from ~/.aidana/config.json.
 * Throws if config file is missing or has no llm section.
 */
export async function loadLlmConfig(): Promise<LlmConfig> {
  const raw = await readFile(CONFIG_PATH, "utf-8");
  const config = JSON.parse(raw) as RawConfig;
  const llm = config.llm;
  if (!llm) {
    throw new Error(`No llm config found in ${CONFIG_PATH}`);
  }
  return {
    endpoint: llm.endpoint,
    apiKey: llm.apiKey,
    model: llm.model,
    proxyPort: llm.proxy?.port ?? 8010,
  };
}

// ---------------------------------------------------------------------------
// Payload / Result types
// ---------------------------------------------------------------------------

export type LlmCallMode = "direct" | "proxy" | "auto";

export interface LlmPayload {
  // Core
  /** The prompt to send to the LLM */
  prompt: string;

  // Mode
  /** Call mode: 'direct' (call LLM backend directly), 'proxy' (via glitcr with smart routing), 'auto' (glitcr decides). Default: 'proxy' */
  mode?: LlmCallMode;

  // Endpoint overrides
  /** Override LLM endpoint URL (e.g. 'http://127.0.0.1:11434/v1') */
  endpoint?: string;
  /** Override API key for LLM backend */
  apiKey?: string;
  /** Override model name (e.g. 'qwen2.5-coder:14b') */
  model?: string;

  // Generation hyperparameters
  /** Sampling temperature */
  temperature?: number;
  /** Maximum tokens in response. Default: 4096 */
  maxTokens?: number;
  /** Top-p nucleus sampling */
  topP?: number;
  /** Top-k sampling */
  topK?: number;
  /** Random seed for reproducibility */
  seed?: number;
  /** Presence penalty */
  presencePenalty?: number;
  /** Frequency penalty */
  frequencyPenalty?: number;
  /** Repetition penalty */
  repetitionPenalty?: number;

  // Reasoning
  /** Enable extended thinking/reasoning mode. Default: false */
  enableThinking?: boolean;

  // Advanced
  /** Maximum recursion depth for proxy strategies. Default: 0 */
  recursionDepth?: number;

  // Embedding (reserved for future use)
  /** Override embedding endpoint URL */
  embeddingEndpoint?: string;
  /** Override embedding model name */
  embeddingModel?: string;
  /** Override embedding API key */
  embeddingApiKey?: string;

  // NER / Relation / Rerank (reserved for future use)
  /** NER model name */
  nerModel?: string;
  /** Relation extraction model name */
  relationModel?: string;
  /** Reranker model name */
  rerankModel?: string;
}

export interface LlmResult {
  /** The LLM response text */
  text: string;
  /** Model that generated the response */
  model?: string;
  /** Reasoning/thinking content if thinking was enabled */
  reasoningContent?: string;
  /** Tokens used */
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

// ---------------------------------------------------------------------------
// MCP metadata
// ---------------------------------------------------------------------------

/** MCP metadata for auto-discovery */
export const mcpMeta: McpToolMeta = {
  workItemType: "llm",
  name: "llm",
  description:
    "Send a prompt to the LLM. Supports direct backend calls (mode=direct) or proxied calls via glitcr (mode=proxy) with smart routing. All generation hyperparameters can be overridden per-call.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "The prompt to send to the LLM",
      },
      mode: {
        type: "string",
        description:
          "Call mode: 'direct' (call LLM backend directly), 'proxy' (via glitcr with smart routing), 'auto' (glitcr decides). Default: 'proxy'",
        default: "proxy",
      },
      // Endpoint overrides
      endpoint: {
        type: "string",
        description: "Override LLM endpoint URL (e.g. 'http://127.0.0.1:11434/v1')",
      },
      apiKey: {
        type: "string",
        description: "Override API key for LLM backend",
      },
      model: {
        type: "string",
        description: "Override model name (e.g. 'qwen2.5-coder:14b')",
      },
      // Generation hyperparameters
      temperature: {
        type: "number",
        description: "Sampling temperature",
      },
      maxTokens: {
        type: "number",
        description: "Maximum tokens in response. Default: 4096",
        default: 4096,
      },
      topP: {
        type: "number",
        description: "Top-p nucleus sampling",
      },
      topK: {
        type: "number",
        description: "Top-k sampling",
      },
      seed: {
        type: "number",
        description: "Random seed for reproducibility",
      },
      presencePenalty: {
        type: "number",
        description: "Presence penalty",
      },
      frequencyPenalty: {
        type: "number",
        description: "Frequency penalty",
      },
      repetitionPenalty: {
        type: "number",
        description: "Repetition penalty",
      },
      // Reasoning
      enableThinking: {
        type: "boolean",
        description: "Enable extended thinking/reasoning mode. Default: false",
        default: false,
      },
      // Advanced
      recursionDepth: {
        type: "number",
        description: "Maximum recursion depth for proxy strategies. Default: 0",
        default: 0,
      },
      // Embedding (reserved)
      embeddingEndpoint: {
        type: "string",
        description: "Override embedding endpoint URL",
      },
      embeddingModel: {
        type: "string",
        description: "Override embedding model name",
      },
      embeddingApiKey: {
        type: "string",
        description: "Override embedding API key",
      },
      // NER / Relation / Rerank (reserved)
      nerModel: {
        type: "string",
        description: "NER model name",
      },
      relationModel: {
        type: "string",
        description: "Relation extraction model name",
      },
      rerankModel: {
        type: "string",
        description: "Reranker model name",
      },
    },
    required: ["prompt"],
  },
};

// ---------------------------------------------------------------------------
// Request body builder
// ---------------------------------------------------------------------------

/**
 * Build an OpenAI-compatible chat completion request body.
 * Only includes hyperparameters that are explicitly defined.
 */
function buildChatBody(payload: LlmPayload, model: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: "user", content: payload.prompt }],
    stream: false,
  };

  // Generation hyperparameters (only include if defined)
  if (payload.maxTokens !== undefined) body.max_tokens = payload.maxTokens;
  if (payload.temperature !== undefined) body.temperature = payload.temperature;
  if (payload.topP !== undefined) body.top_p = payload.topP;
  if (payload.topK !== undefined) body.top_k = payload.topK;
  if (payload.seed !== undefined) body.seed = payload.seed;
  if (payload.presencePenalty !== undefined) body.presence_penalty = payload.presencePenalty;
  if (payload.frequencyPenalty !== undefined) body.frequency_penalty = payload.frequencyPenalty;
  if (payload.repetitionPenalty !== undefined) body.repetition_penalty = payload.repetitionPenalty;

  // Reasoning / thinking
  if (payload.enableThinking) {
    body.reasoning_effort = "high";
  }

  return body;
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

/**
 * Parse an OpenAI-compatible chat completion response into LlmResult.
 */
function parseChatResponse(data: any): LlmResult {
  const choice = data.choices?.[0];
  if (!choice) {
    throw new Error("LLM returned empty response (no choices)");
  }

  const result: LlmResult = {
    text: choice.message?.content ?? "",
    model: data.model,
    usage: data.usage
      ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        }
      : undefined,
  };

  // Extract reasoning content if present (o-series format)
  if (choice.message?.reasoning_content) {
    result.reasoningContent = choice.message.reasoning_content;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Direct call - calls LLM backend directly (no proxy)
// ---------------------------------------------------------------------------

/**
 * Call the LLM backend directly, bypassing the glitcr proxy.
 * Fast path for simple text transformations (dedup, summarization, etc.).
 */
async function callLlmDirect(
  payload: LlmPayload,
  config: { endpoint: string; apiKey: string; model: string },
): Promise<LlmResult> {
  const url = `${config.endpoint}/chat/completions`;
  const body = buildChatBody(payload, config.model);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM direct call failed (${response.status}): ${errorText}`);
  }

  return parseChatResponse(await response.json());
}

// ---------------------------------------------------------------------------
// Proxied call - calls through glitcr proxy
// ---------------------------------------------------------------------------

/**
 * Call the LLM via the glitcr proxy.
 * Enables smart routing, strategies, MCP tools, and audit logging.
 */
async function callLlmProxied(
  payload: LlmPayload,
  config: { endpoint: string; apiKey: string; model: string; proxyPort: number },
): Promise<LlmResult> {
  const url = `http://127.0.0.1:${config.proxyPort}/v1/chat/completions`;
  const body = buildChatBody(payload, config.model);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM proxied call failed (${response.status}): ${errorText}`);
  }

  return parseChatResponse(await response.json());
}

// ---------------------------------------------------------------------------
// Unified entry point
// ---------------------------------------------------------------------------

/**
 * Call the LLM with the given payload.
 *
 * Mode resolution:
 *   - "direct"  → calls LLM backend directly (fast, no proxy overhead)
 *   - "proxy"   → calls through glitcr proxy (smart routing, strategies)
 *   - "auto"    → lets glitcr decide routing
 *
 * Config priority: per-call override > config.json > hardcoded fallback
 */
export async function callLlm(payload: LlmPayload): Promise<LlmResult> {
  const config = await loadLlmConfig();
  const mode = payload.mode ?? "proxy";

  // Merge: per-call overrides take priority over config defaults
  const merged = {
    endpoint: payload.endpoint ?? config.endpoint,
    apiKey: payload.apiKey ?? config.apiKey,
    model: payload.model ?? config.model,
    proxyPort: config.proxyPort,
  };

  if (mode === "direct") {
    return callLlmDirect(payload, merged);
  }

  // "proxy" and "auto" both go through glitcr
  return callLlmProxied(payload, merged);
}
