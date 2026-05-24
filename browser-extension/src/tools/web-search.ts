import type { McpToolMeta } from "../types.js";

/** MCP metadata for the aggregate web_search tool */
export const mcpMeta: McpToolMeta = {
  workItemType: "web_search",
  name: "web_search",
  description:
    "Search Google and scrape the top results. Returns an aggregate JSON with scraped content for each result. Use format='md' for Markdown or format='html' for cleaned HTML per result.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query",
      },
      topK: {
        type: "number",
        description: "Number of top results to scrape (default: 3)",
        default: 3,
      },
      format: {
        type: "string",
        description: "Content format per result: 'md' (Markdown) or 'html' (cleaned HTML). Default: 'md'",
        default: "md",
      },
      closeTab: {
        type: "boolean",
        description: "Whether to close the search tab after scraping. Default: true",
        default: true,
      },
    },
    required: ["query"],
  },
};
