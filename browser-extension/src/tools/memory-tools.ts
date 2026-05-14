import type { McpToolMeta } from "../types.js";

export const memoryListFilesMeta: McpToolMeta = {
  workItemType: "memory_list_files" as any,
  name: "memory_list_files",
  description:
    "List all memory files as an ASCII hierarchy tree based on their relationships. Shows file name, type, size, and archived status. Meta files are hidden.",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
};

export const memoryFileReadMeta: McpToolMeta = {
  workItemType: "memory_file_read" as any,
  name: "memory_file_read",
  description:
    "Read the content of a memory file by name (without extension).",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Memory file name without extension, e.g. 'project-notes'",
      },
    },
    required: ["name"],
  },
};

export const memoryFileSaveMeta: McpToolMeta = {
  workItemType: "memory_file_save" as any,
  name: "memory_file_save",
  description:
    "Save or update a memory file. Creates a .md file and companion meta file with summary, keywords, and relationships. If the file exists, it is overwritten.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Memory file name without extension, e.g. 'project-notes'",
      },
      content: {
        type: "string",
        description: "The text content to save (Markdown)",
      },
      fileType: {
        type: "string",
        description: "Type of memory: note, fact, task, reference, other",
        default: "note",
      },
      summary: {
        type: "string",
        description: "A short one-line summary of this memory",
      },
      keywords: {
        type: "array",
        description: "List of keyword strings for search and indexing",
        default: [],
      },
      relatedTo: {
        type: "array",
        description: "List of other memory file names this relates to (without extension). Empty means top-level.",
        default: [],
      },
    },
    required: ["name", "content", "summary"],
  },
};

export const memoryFileArchiveMeta: McpToolMeta = {
  workItemType: "memory_file_archive" as any,
  name: "memory_file_archive",
  description:
    "Archive a memory file (soft-delete). The file is marked as archived in its metadata but not removed. Archived files show as (archived) in listings.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Memory file name without extension",
      },
    },
    required: ["name"],
  },
};

export const memorySearchMeta: McpToolMeta = {
  workItemType: "memory_search" as any,
  name: "memory_search",
  description:
    "Search memory files by keyword. Returns matching file names with their summary and type. Searches the keywords array and summary field in meta data.",
  inputSchema: {
    type: "object",
    properties: {
      keywords: {
        type: "array",
        description: "Keywords to search for. A file matches if any keyword appears in its keywords array or summary.",
      },
    },
    required: ["keywords"],
  },
};

export const memoryFileAppendMeta: McpToolMeta = {
  workItemType: "memory_file_append" as any,
  name: "memory_file_append",
  description:
    "Append content to an existing memory file. Updates the meta file size and timestamp. If the file doesn't exist, creates it.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Memory file name without extension",
      },
      content: {
        type: "string",
        description: "Content to append (prepended with a separator if file exists)",
      },
    },
    required: ["name", "content"],
  },
};

export const memoryFileMetaMeta: McpToolMeta = {
  workItemType: "memory_file_meta" as any,
  name: "memory_file_meta",
  description:
    "Read the metadata of a memory file without loading its content. Returns name, type, summary, keywords, relatedTo, archived status, size, and timestamps.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Memory file name without extension",
      },
    },
    required: ["name"],
  },
};
