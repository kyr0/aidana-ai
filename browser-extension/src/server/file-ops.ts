import { access, mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { AsyncLocalStorage } from "node:async_hooks";
import { dirname, normalize, resolve, sep } from "node:path";
import { runtimeConfig } from "./runtime-config.js";

/** Global default workspace — updated by setWorkspacePath (non-async-context path) */
let globalWorkspacePath = runtimeConfig.workspacePath;

/** Per-async-context workspace overrides (e.g. per HTTP request via X-Aidana-Workspace) */
const workspaceStore = new AsyncLocalStorage<string>();

export function getWorkspacePath(): string {
  return workspaceStore.getStore() ?? globalWorkspacePath;
}

export function setWorkspacePath(newPath: string): void {
  globalWorkspacePath = resolve(newPath);
  console.log(`[file-ops] workspace path set to: ${newPath}`);
}

/** Run an async callback with a per-context workspace override. */
export async function withWorkspacePath<T>(path: string, fn: () => Promise<T>): Promise<T> {
  return workspaceStore.run(resolve(path), fn);
}

export async function ensureWorkspacePathExists(): Promise<void> {
  await mkdir(globalWorkspacePath, { recursive: true });
}

/** Resolve a relative path against the workspace root, rejecting traversal. */
function safePath(relativePath: string): string {
  const root = workspacePath;
  const resolved = resolve(root, relativePath);
  const normalizedRoot = normalize(resolve(root));
  const normalizedResolved = normalize(resolved);

  if (
    normalizedResolved !== normalizedRoot &&
    !normalizedResolved.startsWith(`${normalizedRoot}${sep}`)
  ) {
    throw new Error(`Path traversal denied: ${relativePath}`);
  }
  return resolved;
}

export interface DirEntry {
  name: string;
  isDirectory: boolean;
}

/** List directory contents at an absolute path. Directories sort first. */
export async function listDirectory(dirPath: string): Promise<DirEntry[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((e) => !e.name.startsWith("."))
    .map((e) => ({ name: e.name, isDirectory: e.isDirectory() }))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export async function fileRead(relativePath: string): Promise<string> {
  const abs = safePath(relativePath);
  return readFile(abs, "utf-8");
}

export async function fileWrite(
  relativePath: string,
  content: string,
): Promise<void> {
  const abs = safePath(relativePath);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf-8");
}

export async function fileDelete(relativePath: string): Promise<void> {
  const abs = safePath(relativePath);
  try {
    await access(abs);
    await unlink(abs);
  } catch {
    // File doesn't exist — idempotent delete
  }
}

export async function fileMove(
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  const source = safePath(sourcePath);
  const dest = safePath(destinationPath);
  await mkdir(dirname(dest), { recursive: true });
  await rename(source, dest);
}

// MARK: - Memory Management

const memoryDir = "memory";

interface MemoryMeta {
  name: string;
  fileType: string;
  summary: string;
  keywords: string[];
  relatedTo: string[];
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  archivedAt?: string;
  size: number;
}

function memoryFilePath(name: string): string {
  return `${memoryDir}/${name}.md`;
}

function memoryMetaPath(name: string): string {
  return `${memoryDir}/${name}_meta.json`;
}

async function readMeta(name: string): Promise<MemoryMeta | null> {
  const path = memoryMetaPath(name);
  try {
    const abs = safePath(path);
    const text = await readFile(abs, "utf-8");
    return JSON.parse(text) as MemoryMeta;
  } catch {
    return null;
  }
}

async function writeMeta(meta: MemoryMeta): Promise<void> {
  const path = memoryMetaPath(meta.name);
  const abs = safePath(path);
  await mkdir(dirname(abs), { recursive: true });
  const json = JSON.stringify(meta, null, 2) + "\n";
  await writeFile(abs, json, "utf-8");
}

export async function memoryListFiles(): Promise<string> {
  const root = safePath(memoryDir);
  let entries: string[];
  try {
    const raw = await readdir(root, { withFileTypes: true });
    entries = raw
      .filter((e) => !e.name.startsWith("."))
      .map((e) => e.name);
  } catch {
    return JSON.stringify({ files: [] });
  }

  // Collect memory file names (exclude meta files)
  const memoryNames = entries
    .filter((f) => f.endsWith(".md") && !f.endsWith("_meta.json"))
    .map((f) => f.replace(/\.md$/, ""));

  if (memoryNames.length === 0) {
    return JSON.stringify({ files: [] });
  }

  // Load all meta data and build file entries
  const files: Array<{
    name: string;
    type: string;
    summary: string;
    keywords: string[];
    relatedTo: string[];
    archived: boolean;
    size: number;
    createdAt: string;
    updatedAt: string;
  }> = [];

  for (const name of memoryNames.sort()) {
    const meta = await readMeta(name);
    if (meta) {
      files.push({
        name,
        type: meta.fileType ?? "unknown",
        summary: meta.summary ?? "",
        keywords: meta.keywords ?? [],
        relatedTo: meta.relatedTo ?? [],
        archived: meta.archived ?? false,
        size: meta.size ?? 0,
        createdAt: meta.createdAt ?? "",
        updatedAt: meta.updatedAt ?? "",
      });
    }
  }

  return JSON.stringify({ files }, null, 2);
  }
  
  export async function memoryFileRead(name: string): Promise<string> {
  const path = memoryFilePath(name);
  const abs = safePath(path);
  return readFile(abs, "utf-8");
}

export async function memoryFileSave(
  name: string,
  content: string,
  fileType: string,
  summary: string,
  keywords: string[],
  relatedTo: string[],
): Promise<void> {
  // Ensure memory directory exists
  const dirAbs = safePath(memoryDir);
  await mkdir(dirAbs, { recursive: true });

  // Write content file
  const filePath = memoryFilePath(name);
  const fileAbs = safePath(filePath);
  await writeFile(fileAbs, content, "utf-8");

  // Write meta file
  const now = new Date().toISOString();
  const meta: MemoryMeta = {
    name,
    fileType,
    summary,
    keywords: keywords ?? [],
    relatedTo: relatedTo ?? [],
    createdAt: now,
    updatedAt: now,
    archived: false,
    size: Buffer.byteLength(content, "utf-8"),
  };
  await writeMeta(meta);
}

export async function memoryFileArchive(name: string): Promise<void> {
  const meta = await readMeta(name);
  if (!meta) {
    throw new Error(`Memory file not found: ${name}`);
  }
  meta.archived = true;
  meta.archivedAt = new Date().toISOString();
  meta.updatedAt = new Date().toISOString();
  await writeMeta(meta);
}

export async function memorySearch(keywords: string[]): Promise<string> {
  const root = safePath(memoryDir);
  let entries: string[];
  try {
    const raw = await readdir(root, { withFileTypes: true });
    entries = raw
      .filter((e) => !e.name.startsWith("."))
      .map((e) => e.name);
  } catch {
    return "(no memory files yet)";
  }

  const memoryNames = entries
    .filter((f) => f.endsWith(".md") && !f.endsWith("_meta.json"))
    .map((f) => f.replace(/\.md$/, ""));

  if (memoryNames.length === 0) {
    return "(no memory files yet)";
  }

  const searchTerms = keywords.map((k) => k.toLowerCase());
  const matches: string[] = [];

  for (const name of memoryNames) {
    const meta = await readMeta(name);
    if (!meta) continue;

    const metaKeywords = (meta.keywords ?? []).map((k) => k.toLowerCase());
    const metaSummary = (meta.summary ?? "").toLowerCase();

    const hasMatch = searchTerms.some((term) => {
      return metaKeywords.some((kw) => kw.includes(term)) || metaSummary.includes(term);
    });

    if (hasMatch) {
      const status = meta.archived ? " (archived)" : "";
      matches.push(`- ${name}.md [${meta.fileType}] "${meta.summary}"${status}`);
    }
  }

  if (matches.length === 0) {
    return `No memories found matching: ${keywords.join(", ")}`;
  }

  return `Found ${matches.length} match(es):\n${matches.join("\n")}`;
}

export async function memoryFileAppend(
  name: string,
  content: string,
): Promise<void> {
  const filePath = memoryFilePath(name);
  const fileAbs = safePath(filePath);

  let existing = "";
  try {
    existing = await readFile(fileAbs, "utf-8");
  } catch {
    // File doesn't exist — will create it
  }

  const separator = existing.length > 0 ? "\n\n---\n\n" : "";
  const updated = existing + separator + content;
  await writeFile(fileAbs, updated, "utf-8");

  // Update meta
  const existingMeta = await readMeta(name);
  const now = new Date().toISOString();
  const meta: MemoryMeta = {
    name,
    fileType: existingMeta?.fileType ?? "note",
    summary: existingMeta?.summary ?? "",
    keywords: existingMeta?.keywords ?? [],
    relatedTo: existingMeta?.relatedTo ?? [],
    createdAt: existingMeta?.createdAt ?? now,
    updatedAt: now,
    archived: existingMeta?.archived ?? false,
    archivedAt: existingMeta?.archivedAt,
    size: Buffer.byteLength(updated, "utf-8"),
  };
  await writeMeta(meta);
}

export async function memoryFileMeta(name: string): Promise<string> {
  const meta = await readMeta(name);
  if (!meta) {
    throw new Error(`Memory file not found: ${name}`);
  }
  return JSON.stringify(meta, null, 2);
}
