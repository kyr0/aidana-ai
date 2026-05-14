import type { McpToolMeta } from "./types.js";
import { mcpMeta as googleSearch } from "./tools/google-search.js";
import { mcpMeta as arztSuche } from "./tools/116117-arztsuche.js";
import { mcpMeta as scrape } from "./tools/scrape.js";
import { mcpMeta as downloadFile } from "./tools/download-file.js";
import {
  memoryListFilesMeta,
  memoryFileReadMeta,
  memoryFileSaveMeta,
  memoryFileArchiveMeta,
  memorySearchMeta,
  memoryFileAppendMeta,
  memoryFileMetaMeta,
} from "./tools/memory-tools.js";

/** All MCP-exposed tools — add new tool imports here */
export const allMcpTools: McpToolMeta[] = [
  googleSearch,
  arztSuche,
  scrape,
  downloadFile,
  memoryListFilesMeta,
  memoryFileReadMeta,
  memoryFileSaveMeta,
  memoryFileArchiveMeta,
  memorySearchMeta,
  memoryFileAppendMeta,
  memoryFileMetaMeta,
];
