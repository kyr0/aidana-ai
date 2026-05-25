import type { McpToolMeta } from "../types.js";

// ---------------------------------------------------------------------------
// Payload / Result types
// ---------------------------------------------------------------------------

export interface LlmPayload {
  /** The prompt to send to the LLM */
  prompt: string;
  /** Enable reasoning (extended thinking) mode. Default: false */
  reasoning?: boolean;
  /** Override the model name. When omitted, uses the proxy default. */
  model?: string;
  /** Maximum tokens in the response. Default: 4096 */
  maxTokens?: number;
}

export interface LlmResult {
  /** The LLM response text */
  text: string;
  /** Model that generated the response */
  model?: string;
  /** Reasoning/thinking content if reasoning was enabled */
  reasoningContent?: string;
  /** Tokens used */
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

/** MCP metadata for auto-discovery */
export const mcpMeta: McpToolMeta = {
  workItemType: "llm",
  name: "llm",
  description:
    "Send a prompt to the LLM via the glitcr proxy. Use reasoning=true for complex tasks that benefit from extended thinking (dedup, summarization, topic extraction).",
  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "The prompt to send to the LLM",
      },
      reasoning: {
        type: "boolean",
        description: "Enable reasoning (extended thinking) mode. Default: false",
        default: false,
      },
      model: {
        type: "string",
        description: "Override the model name. When omitted, uses the proxy default.",
      },
      maxTokens: {
        type: "number",
        description: "Maximum tokens in the response. Default: 4096",
        default: 4096,
      },
    },
    required: ["prompt"],
  },
};

/**
 * Call the glitcr proxy (OpenAI-compatible) with the given prompt.
 * This is the internal implementation used by mcp-protocol.ts.
 */
export async function callLlm(payload: LlmPayload): Promise<LlmResult> {
  const proxyPort = parseInt(process.env.GLITCR_PORT ?? "18645", 10);
  const endpoint = `http://127.0.0.1:${proxyPort}/v1/chat/completions`;

  const body: Record<string, unknown> = {
    model: payload.model ?? "auto",
    messages: [
      { role: "user", content: payload.prompt },
    ],
    max_tokens: payload.maxTokens ?? 4096,
    stream: false,
  };

  // Enable reasoning if requested (OpenAI o-series style)
  if (payload.reasoning) {
    body.reasoning_effort = "high";
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM proxy returned ${response.status}: ${errorText}`);
  }

  const data = await response.json() as any;
  const choice = data.choices?.[0];
  if (!choice) {
    throw new Error("LLM proxy returned empty response");
  }

  const result: LlmResult = {
    text: choice.message?.content ?? "",
    model: data.model,
    usage: data.usage ? {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    } : undefined,
  };

  // Extract reasoning content if present (o-series format)
  if (choice.message?.reasoning_content) {
    result.reasoningContent = choice.message.reasoning_content;
  }

  return result;
}
