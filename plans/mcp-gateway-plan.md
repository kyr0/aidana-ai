# Aidana General MCP Gateway — Final Implementation Plan v3

## 0. Purpose

Aidana is a **local, generalized, intelligent MCP gateway**.

It is not a special-purpose coding-agent MCP server. It is a **higher-level agent capability layer** for any agentic workflow:

- chat assistants
- voice assistants
- coding agents
- document-editing agents
- research agents
- personal knowledge assistants
- automation agents
- simple chat sessions that need durable auxiliary memory

The key premise:

> Any useful agentic workflow eventually benefits from the ability to inspect files, edit files, generate code, run code, verify outputs, remember sessions, maintain structured knowledge, and use semantic/symbolic lookup over a workspace.

Therefore, Aidana exposes **general intelligence tools** on top of lower-level capabilities.

```text
Upstream agent/client
  ↓ one local Streamable-HTTP MCP connection
Aidana MCP Gateway
  ├─ high-level/superset tools announced by default
  ├─ low-level tool registry, enumerable on request
  ├─ current browser/work-queue tools
  ├─ agentmemory: chat-session continuity
  ├─ Neo4j Agent Memory: durable project/person/workspace knowledge graph
  ├─ CodeGraph: broad symbolic lookup over supported file types
  ├─ Serena LSP: precise semantic lookup/edit/refactor/diagnostics
  └─ REPL/RLM sandbox: deterministic execution/proofing with workspace mount
```

Aidana must feel like **one smarter local MCP server**, not a pile of unrelated MCP servers.

---

## 1. Non-negotiable architecture constraints

```text
1. Upstream clients connect only to the Aidana MCP gateway.
2. Aidana is locally hosted on the developer/user machine.
3. Main public transport is Streamable HTTP.
4. The workspace is always supplied by X-Aidana-Workspace.
5. X-Aidana-Workspace is always an absolute path.
6. Never use X-Aidata-* headers.
7. Workspace-local state lives in <workspace>/.aidana/.
8. Global user config lives in ~/.aidana/.
9. Aidana integrates new low-level tools next to existing tools.
10. Aidana announces only high-level/superset tools by default.
11. Low-level tools are enumerable through get_all_low_level_tools.
12. Low-level tools are invokable through call_low_level_tool.
13. agentmemory owns chat-session continuity.
14. Neo4j Agent Memory owns durable structured memory and workspace/project Wiki memory.
15. CodeGraph owns broad symbolic lookup over all supported workspace file types.
16. Serena LSP owns precise semantic lookup, references, diagnostics, and semantic edits.
17. No JetBrains Serena integration.
18. REPL/RLM sandbox owns deterministic proof/execution workflows.
19. Downstream auth is static server config and invisible to upstream users.
20. Optional gateway auth only uses X-Aidana-ApiKey if configured.
21. No PII removal by default.
22. Credential redaction for logs/state can be implemented, but must be easy to disable.
23. Binary files and large files are skipped before text/symbolic indexing.
24. Every feature gets technical end-to-end localhost tests.
```

---

## 2. Conceptual ownership

Use neutral, general-purpose wording everywhere.

| Component | Owns | Not limited to |
|---|---|---|
| Aidana Gateway | orchestration, routing, policy, config, state, tool introspection, recursion control | not only coding |
| Existing browser/work-queue tools | browser automation, search, scrape, download, ChatGPT/Consensus workflows | not deprecated |
| agentmemory | chat-session continuity, previous actions, decisions, errors, summaries, timelines | not only coding sessions |
| Neo4j Agent Memory | structured knowledge graph, Wiki-like workspace memory, short-term/long-term/reasoning memory | not only agent internals |
| CodeGraph | broad symbolic lookup over supported files: code, Markdown, text-like project artifacts where supported | not only source code |
| Serena LSP | precise semantic navigation/editing/diagnostics over LSP-supported files | no JetBrains backend |
| REPL/RLM sandbox | deterministic execution, proof by code, generated scripts, data transforms, experiments | not only Python snippets |
| LLM direct config | model calls to backend local inference endpoint | no MCP recursion |
| LLM proxy config | model calls to glitcr smart proxy with Aidana MCP access | allows recursive smart tools |

Preferred phrases:

```text
chat-session continuity
workspace memory
structured knowledge lookup
symbolic workspace lookup
semantic workspace lookup
proof by execution
superset tools
low-level tools
```

Avoid these phrases as architecture labels:

```text
coding-agent memory only
code-only lookup only
project-specific implementation only
```

---

## 3. Public MCP tool model

Aidana has two tool layers.

### 3.1 Default-announced superset tools

These are returned by normal MCP `tools/list`.

```text
ws_status
ws_sync

ask
kg_ask
mem_resume
code_ask
proof_run

get_all_low_level_tools
call_low_level_tool

kg_find
kg_put
kg_link
kg_query
kg_context
kg_review

mem_recall
mem_note
mem_sessions
mem_timeline
mem_close

sym_find
sym_ctx
sym_impact
sym_path
sym_map
sym_diff
sym_index

sem_def
sem_refs
sem_impls
sem_diag
sem_rename
sem_edit
sem_delete
sem_restart
```

Reasoning:

- The upstream agent sees a clean high-level interface.
- The upstream agent can still inspect and invoke lower-level tools when it wants to build its own orchestration.
- Superset tools remain stable even if downstream raw tool names change.

### 3.2 Low-level tools

Low-level tools include:

```text
legacy browser/work-queue tools:
  scrape
  download_file
  google_maps
  consensus
  google_search
  web_search
  chatgpt
  memory_list_files
  memory_file_read
  memory_file_save
  memory_file_archive
  memory_search
  memory_file_append
  memory_file_meta
  all existing allMcpTools-backed browser/automation tools

agentmemory raw/adapter tools
Neo4j Agent Memory raw/adapter tools
CodeGraph raw/adapter tools
Serena LSP raw/adapter tools
sandbox raw/adapter tools
model direct/proxy call tools
```

Low-level tools are **not announced by default**, but can be discovered through:

```text
get_all_low_level_tools
```

and invoked through:

```text
call_low_level_tool
```

---

## 4. Final public tool definitions

## 4.1 Workspace/system tools

### `ws_status`

Return active workspace, `.aidana` state, current session, downstream health, index status, LLM config summary, and low-level tool registry summary.

Input:

```ts
{
  verbose?: boolean;
}
```

### `ws_sync`

Initialize or refresh workspace state, downstream clients, symbolic indexes, LSP activation, memory namespaces, sandbox readiness, and Neo4j workspace entity.

Input:

```ts
{
  full?: boolean;
  include?: Array<
    | "legacy"
    | "agentmemory"
    | "neo4j"
    | "codegraph"
    | "serena"
    | "sandbox"
    | "models"
  >;
}
```

---

## 4.2 Low-level introspection/control tools

### `get_all_low_level_tools`

Enumerate all available low-level tools, including existing browser/work-queue tools and downstream MCP tools.

Input:

```ts
{
  includeSchemas?: boolean;
  includeRawDownstream?: boolean;
  filter?: {
    source?: Array<"legacy" | "agentmemory" | "neo4j" | "codegraph" | "serena" | "sandbox" | "model">;
    capability?: string[];
    query?: string;
  };
}
```

Output data:

```ts
{
  tools: Array<{
    name: string;              // namespaced stable name, e.g. "serena.find_symbol"
    displayName?: string;
    source: string;
    downstream?: string;
    rawName?: string;
    description: string;
    inputSchema?: object;
    capabilities: string[];
    sideEffects: "none" | "read" | "write" | "execute" | "network";
    workspaceScoped: boolean;
    timeoutMs: number;
  }>;
}
```

### `call_low_level_tool`

Invoke a low-level tool by stable namespaced name.

Input:

```ts
{
  name: string;
  arguments?: Record<string, unknown>;
  timeoutMs?: number;
  allowSideEffects?: boolean;
}
```

Rules:

1. Tool name must exist in the low-level registry.
2. Workspace context is always injected.
3. Calls are logged in `.aidana/events/`.
4. Downstream auth is never exposed.
5. If the low-level tool has side effects and `allowSideEffects !== true`, return `SIDE_EFFECT_CONFIRMATION_REQUIRED`.
6. `allowSideEffects` is a machine contract, not a user confirmation prompt.

---

## 4.3 Unified intelligent tools

### `ask`

General high-level question router.

It can choose between:

- structured memory
- chat-session memory
- symbolic workspace lookup
- semantic LSP lookup
- web/research tools
- direct LLM call
- proxy/smart LLM call
- REPL/RLM proof execution

Input:

```ts
{
  question: string;
  mode?:
    | "auto"
    | "knowledge"
    | "session"
    | "symbolic"
    | "semantic"
    | "web"
    | "research"
    | "repl-proof"
    | "mixed";
  budgetTokens?: number;
  limit?: number;
  requireEvidence?: boolean;
  allowWeb?: boolean;
  allowSandbox?: boolean;
  llmMode?: "direct" | "proxy" | "auto";
}
```

Mode behavior:

| Mode | Preferred route |
|---|---|
| `knowledge` | Neo4j Agent Memory |
| `session` | agentmemory + `.aidana` session state |
| `symbolic` | CodeGraph |
| `semantic` | Serena LSP |
| `web` | existing google_search/web_search/scrape/Consensus/ChatGPT tools |
| `research` | web tools + optional smart proxy synthesis |
| `repl-proof` | sandbox execution + diagnostics + symbolic/semantic feedback |
| `mixed` | parallel retrieval and ranking |
| `auto` | classifier chooses plan |

### `code_ask`

Historical name retained for compatibility, but description must be generalized:

> Ask a natural-language question about workspace files/symbols/structures. Uses broad symbolic lookup first and semantic validation when useful.

Input:

```ts
{
  question: string;
  target?: string;
  limit?: number;
  budgetTokens?: number;
  includeMemory?: boolean;
}
```

### `proof_run`

Run code or generated proof scripts in the adapted REPL/RLM sandbox with workspace mount and optional Aidana MCP feedback from inside the sandbox.

Input:

```ts
{
  language: "python" | "javascript" | "typescript" | "bash";
  code?: string;
  file?: string;
  args?: string[];
  timeoutMs?: number;
  packages?: string[];
  purpose?: "proof" | "experiment" | "transform" | "test" | "artifact";
  allowNetwork?: boolean;
  writeAccess?: boolean;
  afterRun?: {
    diagnostics?: boolean;
    symbolicDiff?: boolean;
    captureArtifacts?: boolean;
  };
}
```

---

## 4.4 Knowledge graph tools with explicit memory tiers

Neo4j Agent Memory has a distinctive 3-tier model:

```text
short_term  = recent/relevant conversations/messages
long_term   = durable entities, facts, preferences, decisions, relationships
reasoning   = prior traces, tool calls, outcomes, solution attempts, failures
```

Aidana must expose this explicitly through `kg_*` options.

### Shared `KgMemoryOptions`

```ts
type KgMemoryOptions = {
  tiers?: Array<"auto" | "short_term" | "long_term" | "reasoning">;
  fusion?: "auto" | "single_tier" | "cross_tier";
  sessionIds?: string[];
  currentSessionOnly?: boolean;
  timeRange?: {
    from?: string;
    to?: string;
  };
  reasoningView?: "none" | "summary" | "steps" | "tool_calls" | "outcomes";
  includeProvenance?: boolean;
  includeEdges?: boolean;
  includeScores?: boolean;
  limit?: number;
  depth?: number;
};
```

Default:

```ts
{
  tiers: ["auto"],
  fusion: "auto",
  reasoningView: "summary",
  includeProvenance: true,
  includeEdges: true,
  limit: 20,
  depth: 2
}
```

Important reasoning-memory rule:

```text
Expose reasoning memory as task summaries, steps summaries, tool calls, observations, outcomes, failures, and affected entities/files.
Do not expose hidden chain-of-thought blobs.
```

### `kg_ask`

Answer a natural-language question over structured memory.

Input:

```ts
{
  question: string;
  memory?: KgMemoryOptions;
  answerMode?: "concise" | "detailed" | "evidence_first";
}
```

### `kg_find`

Find memory objects directly.

Input:

```ts
{
  query: string;
  types?: Array<
    | "entity"
    | "fact"
    | "preference"
    | "decision"
    | "message"
    | "conversation"
    | "reasoning_trace"
    | "tool_call"
  >;
  memory?: KgMemoryOptions;
}
```

### `kg_put`

Store memory.

Input:

```ts
{
  text: string;
  source?: string;
  tags?: string[];
  writeMode?:
    | "auto"
    | "short_term_message"
    | "long_term_knowledge"
    | "reasoning_trace"
    | "fused_interaction";
  extraction?: {
    entities?: boolean;
    facts?: boolean;
    preferences?: boolean;
    decisions?: boolean;
    relationships?: boolean;
    reasoningTrace?: boolean;
  };
  memory?: Pick<KgMemoryOptions, "sessionIds" | "includeProvenance">;
}
```

### `kg_link`

Create/update a typed relationship between two known entities/facts.

Input:

```ts
{
  from: EntityRef;
  relation: string;
  to: EntityRef;
  provenance?: Provenance;
  confidence?: number;
}
```

### `kg_query`

Run guarded read-only graph query.

Input:

```ts
{
  query: string;
  params?: Record<string, unknown>;
  memory?: {
    tiers?: Array<"short_term" | "long_term" | "reasoning">;
    enforceTierFilter?: boolean;
  };
}
```

Reject write clauses.

### `kg_context`

Return compact prompt context.

Input:

```ts
{
  target: string;
  purpose?: string;
  memory?: KgMemoryOptions;
  budgetTokens?: number;
}
```

### `kg_review`

Review memory quality issues.

Input:

```ts
{
  reviewType:
    | "pending_same_as"
    | "duplicate_entities"
    | "conflicting_facts"
    | "stale_preferences"
    | "failed_reasoning"
    | "low_confidence_extractions";
  memory?: KgMemoryOptions;
}
```

---

## 4.5 Chat-session memory tools

### `mem_resume`

Return compact continuation context for the current workspace/session.

Input:

```ts
{
  query?: string;
  sessionId?: string;
  limit?: number;
}
```

### `mem_recall`

Retrieve prior relevant actions, observations, files, errors, commands, decisions, tests, and conventions.

Input:

```ts
{
  query: string;
  sessionId?: string;
  limit?: number;
}
```

### `mem_note`

Store an explicit memory note for the current chat/workspace/session.

Input:

```ts
{
  kind?: "note" | "action" | "decision" | "error" | "test" | "convention" | "summary";
  text: string;
  tags?: string[];
}
```

### `mem_sessions`

List/search sessions from `.aidana` plus agentmemory.

Input:

```ts
{
  query?: string;
  limit?: number;
  includeClosed?: boolean;
}
```

### `mem_timeline`

Return a compact event timeline for a selected session.

Input:

```ts
{
  sessionId?: string;
  limit?: number;
}
```

### `mem_close`

Summarize and close current session.

Input:

```ts
{
  sessionId?: string;
  title?: string;
  summary?: string;
  nextSteps?: string[];
}
```

---

## 4.6 Symbolic workspace lookup tools

Use `sym_*`, not `code_*`, for new generalized names.

Keep `code_ask` as compatibility alias because it already exists in previous plans.

### `sym_find`

Find symbols, files, headings, routes, modules, tests, documents, or packages by name or natural-language query.

Input:

```ts
{
  query: string;
  kind?: "symbol" | "file" | "heading" | "route" | "test" | "module" | "any";
  limit?: number;
}
```

### `sym_ctx`

Return compact context for a symbol, file, module, heading, route, document, or task.

Input:

```ts
{
  target: string;
  budgetTokens?: number;
}
```

### `sym_impact`

Return callers, callees, dependencies, reverse dependencies, related tests, backlinks, and blast radius where supported.

Input:

```ts
{
  target: string;
  depth?: number;
  includeTests?: boolean;
}
```

### `sym_path`

Find call/import/dependency/link paths between two symbols/files/documents.

Input:

```ts
{
  from: string;
  to: string;
}
```

### `sym_map`

Return architecture/module/document overview for path, package, service, document group, or whole workspace.

Input:

```ts
{
  scope?: string;
  depth?: number;
}
```

### `sym_diff`

Analyze impact of staged/unstaged local changes.

Input:

```ts
{
  staged?: boolean;
  unstaged?: boolean;
}
```

### `sym_index`

Rebuild or incrementally refresh the symbolic index.

Input:

```ts
{
  full?: boolean;
}
```

Compatibility aliases:

```text
code_find   -> sym_find
code_ctx    -> sym_ctx
code_impact -> sym_impact
code_path   -> sym_path
code_map    -> sym_map
code_diff   -> sym_diff
code_index  -> sym_index
```

The default tool list may include either both aliases or only the new names plus `code_ask`. Prefer only new names for clean architecture.

---

## 4.7 Serena LSP semantic tools

No JetBrains integration.

### `sem_def`

Return exact declaration/definition for a symbol using Serena LSP.

Input:

```ts
{
  symbol: string;
  path?: string;
  includeBody?: boolean;
}
```

### `sem_refs`

Return semantic references/usages across workspace.

Input:

```ts
{
  symbol: string;
  path?: string;
  includeDeclaration?: boolean;
}
```

### `sem_impls`

Return implementations/overrides when supported by active language server.

Input:

```ts
{
  symbol: string;
  path?: string;
}
```

### `sem_diag`

Return diagnostics for file, symbol, path, or workspace scope.

Input:

```ts
{
  path?: string;
  symbol?: string;
  scope?: "file" | "workspace";
}
```

### `sem_rename`

Rename a symbol using Serena LSP rename.

Input:

```ts
{
  symbol: string;
  path?: string;
  newName: string;
  dryRun?: boolean;
}
```

### `sem_edit`

Replace a symbol body or insert before/after a symbol using Serena symbolic edit tools.

Input:

```ts
{
  symbol: string;
  path?: string;
  operation: "replace_body" | "insert_before" | "insert_after";
  content: string;
  dryRun?: boolean;
}
```

### `sem_delete`

Safe-delete a symbol after semantic reference checks.

Input:

```ts
{
  symbol: string;
  path?: string;
  dryRun?: boolean;
}
```

### `sem_restart`

Restart Serena/LSP backend for the workspace.

Input:

```ts
{}
```

---

# 5. Header contract

## 5.1 Required workspace header

Always:

```http
X-Aidana-Workspace: /absolute/path/to/workspace
```

Rules:

1. Header is required for all MCP tool calls except global health endpoints.
2. Header must contain an absolute path.
3. Resolve with `realpath`.
4. Reject nonexistent paths unless a specific future tool explicitly creates workspaces.
5. All file operations stay inside this workspace.
6. No `X-Aidata-*` alias.

## 5.2 Optional gateway auth

Startup env:

```bash
AIDANA_API_KEY="optional-local-secret"
```

Runtime rule:

```text
if AIDANA_API_KEY is set:
  require X-Aidana-ApiKey exact match
else:
  skip gateway auth
```

No bearer flow. No OAuth. No user-facing downstream auth.

## 5.3 Optional session headers

```http
X-Aidana-SessionId: optional-session-id
X-Aidana-RequestId: optional-request-id
```

If `X-Aidana-SessionId` is absent:

1. Load `<workspace>/.aidana/state.json`.
2. Use `state.currentSessionId` if present.
3. Otherwise create a new session.
4. Persist it.

## 5.4 Optional model/config override headers

Do not use provider headers. All inference endpoints are OpenAI-compatible.

Direct backend LLM defaults come from `~/.aidana/config.json`.
Smart/proxy LLM defaults come from the same file using `llm.proxy.port`.

Headers override request-local config only.

Recommended headers:

```http
X-Aidana-LLM-Endpoint: http://127.0.0.1:11434/v1
X-Aidana-LLM-Model: qwen2.5-coder:14b
X-Aidana-LLM-ApiKey: optional-local-key

X-Aidana-Embedding-Endpoint: http://127.0.0.1:11434/v1
X-Aidana-Embedding-Model: nomic-embed-text
X-Aidana-Embedding-ApiKey: optional-local-key

X-Aidana-NER-Model: qwen2.5:14b
X-Aidana-Relation-Model: qwen2.5:14b
X-Aidana-Rerank-Model: optional-reranker

X-Aidana-Temperature: 0
X-Aidana-MaxTokens: 4096
X-Aidana-TopP: 1
X-Aidana-TopK: 40
X-Aidana-Seed: 1234
X-Aidana-PresencePenalty: 0
X-Aidana-FrequencyPenalty: 0
X-Aidana-RepetitionPenalty: 1.05
X-Aidana-EnableThinking: true
X-Aidana-LLM-Mode: direct|proxy|auto
X-Aidana-RecursionDepth: 0
```

Remove previous `X-Aidana-Config`. It is not needed.

## 5.5 Header merge order

```text
hardcoded safe defaults
  < ~/.aidana/config.json
  < ~/.aidana/downstream.config.json where relevant
  < process env
  < X-Aidana-* headers
  < explicit tool arguments
```

## 5.6 CORS policy

Local deployment, but browser UI needs CORS.

Allow origins matching:

```text
http://localhost:*
https://localhost:*
http://127.0.0.1:*
https://127.0.0.1:*
http://[::1]:*
https://[::1]:*
http://10.*.*.*:*
https://10.*.*.*:*
http://172.16-31.*.*:*
https://172.16-31.*.*:*
http://192.168.*.*:*
https://192.168.*.*:*
```

Implementation rule:

```ts
function isAllowedLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  const url = new URL(origin);
  const host = url.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  const m = /^172\.(\d{1,2})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return false;
}
```

Required allowed headers:

```text
Origin
X-Requested-With
Content-Type
Accept
Authorization
Content-Encoding
Mcp-Session-Id
Last-Event-ID

X-Aidana-Workspace
X-Aidana-ApiKey
X-Aidana-SessionId
X-Aidana-RequestId
X-Aidana-LLM-Endpoint
X-Aidana-LLM-Model
X-Aidana-LLM-ApiKey
X-Aidana-Embedding-Endpoint
X-Aidana-Embedding-Model
X-Aidana-Embedding-ApiKey
X-Aidana-NER-Model
X-Aidana-Relation-Model
X-Aidana-Rerank-Model
X-Aidana-Temperature
X-Aidana-MaxTokens
X-Aidana-TopP
X-Aidana-TopK
X-Aidana-Seed
X-Aidana-PresencePenalty
X-Aidana-FrequencyPenalty
X-Aidana-RepetitionPenalty
X-Aidana-EnableThinking
X-Aidana-LLM-Mode
X-Aidana-RecursionDepth
```

---

# 6. Global configuration

## 6.1 `~/.aidana/config.json`

Existing schema:

```json
{
  "llm": {
    "endpoint": "http://baradcuda:8920/v1",
    "apiKey": "local-dev-key",
    "model": "Qwen3.6-27B-FP8",
    "autoStart": true,
    "proxy": {
      "autoStart": true,
      "admin_user": "admin",
      "port": 8010,
      "admin_password": "changeme"
    }
  }
}
```

Aidana must read this on startup and reload on demand in `ws_sync`.

Derived configs:

```ts
type DirectLlmConfig = {
  endpoint: string;          // llm.endpoint
  apiKey: string;            // llm.apiKey
  model: string;             // llm.model
  autoStart: boolean;        // llm.autoStart
};

type ProxyLlmConfig = {
  endpoint: string;          // http://127.0.0.1:${llm.proxy.port}/v1
  apiKey: string;            // same llm.apiKey
  model: string;             // same llm.model
  autoStart: boolean;        // llm.proxy.autoStart
  adminUser: string;         // llm.proxy.admin_user
  adminPassword: string;     // llm.proxy.admin_password
};
```

## 6.2 Direct vs proxy LLM calls

### Direct call

Calls the backend inference server directly:

```text
endpoint = config.llm.endpoint
model    = config.llm.model
apiKey   = config.llm.apiKey
```

Use for:

- cheap classification
- extraction
- summarization
- deterministic synthesis
- tasks where MCP recursion is unnecessary

### Proxy/smart call

Calls glitcr intelligent LLM proxy:

```text
endpoint = http://127.0.0.1:${config.llm.proxy.port}/v1
model    = config.llm.model
apiKey   = config.llm.apiKey
```

Use for:

- high-level smart tools that may need to call Aidana MCP recursively
- multi-step tool planning
- complex research orchestration
- agent-generated scripts that can call MCP tools

Recursion guard:

```text
X-Aidana-RecursionDepth default: 0
max default: 3
if depth > max: force direct LLM mode or return RECURSION_LIMIT
```

## 6.3 `~/.aidana/mcp.json`

Existing schema:

```json
{
  "mcpServers": {
    "aidana": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:3211/mcp",
      "timeout": 90
    }
  }
}
```

Use this for:

- sandbox code that calls Aidana MCP
- proxy LLM tool wiring
- self-referential smart orchestration
- health checks for recursive path

## 6.4 `~/.aidana/downstream.config.json`

Move downstream config here.

Default template:

```json
{
  "downstreams": {
    "neo4j": {
      "enabled": true,
      "transport": "stdio",
      "command": "uvx",
      "args": ["neo4j-agent-memory", "mcp", "serve", "--profile", "extended"],
      "env": {
        "NEO4J_URI": "$NEO4J_URI",
        "NEO4J_USERNAME": "$NEO4J_USERNAME",
        "NEO4J_PASSWORD": "$NEO4J_PASSWORD"
      }
    },
    "agentmemory": {
      "enabled": true,
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@agentmemory/mcp"],
      "env": {
        "AGENTMEMORY_URL": "$AGENTMEMORY_URL"
      }
    },
    "codegraph": {
      "enabled": true,
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@colbymchenry/codegraph", "mcp"],
      "cwd": "${workspace}"
    },
    "serena": {
      "enabled": true,
      "transport": "stdio",
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena",
        "start-mcp-server",
        "--context",
        "ide-assistant",
        "--project",
        "${workspace}"
      ],
      "cwd": "${workspace}"
    },
    "sandbox": {
      "enabled": true,
      "transport": "stdio",
      "command": "aidana-code-sandbox-mcp",
      "args": ["serve"],
      "cwd": "${workspace}",
      "env": {
        "AIDANA_MCP_URL": "${aidanaMcpUrl}",
        "AIDANA_HOST_WORKSPACE": "${workspace}",
        "AIDANA_CONTAINER_WORKSPACE": "/workspace"
      }
    }
  }
}
```

Expansion variables:

```text
${workspace}       absolute host workspace path
${workspaceId}     sha256(realpath(workspace)) prefix
${aidanaMcpUrl}    from ~/.aidana/mcp.json mcpServers.aidana.url
${home}            user home dir
${env.NAME}        process env variable NAME
```

---

# 7. Workspace-local `.aidana/` state

Create inside every workspace:

```text
<workspace>/.aidana/
  state.json
  sessions/
    <sessionId>.json
  events/
    <yyyy-mm-dd>.ndjson
  cache/
    low-level-tools.json
    downstream-tools.json
    workspace-fingerprint.json
    symbolic-index-status.json
    serena-status.json
    model-config-last.json
    sandbox-status.json
  locks/
  tmp/
  logs/
    gateway.ndjson
  sandbox/
    artifacts/
    scripts/
    runs/
```

## 7.1 `state.json`

```ts
type AidanaState = {
  schemaVersion: 2;
  workspace: {
    id: string;
    root: string;
    name: string;
    createdAt: string;
    updatedAt: string;
  };
  currentSessionId?: string;
  recentSessionIds: string[];
  sessions: Array<{
    id: string;
    title: string;
    summary: string;
    createdAt: string;
    updatedAt: string;
    closedAt?: string;
    tags: string[];
    backendSessionIds: {
      agentmemory?: string;
      neo4jConversationId?: string;
      neo4jReasoningTraceIds?: string[];
    };
    stats: {
      toolCalls: number;
      filesTouched: number;
      symbolsTouched: number;
      errors: number;
      sandboxRuns: number;
    };
  }>;
  kg: {
    defaultMemory: KgMemoryOptions;
    reasoningPolicy: {
      allowRawThoughts: false;
      defaultView: "summary";
      storeToolCalls: true;
      storeOutcomes: true;
    };
  };
  indexes: {
    symbolic?: {
      lastSyncAt?: string;
      status: "missing" | "stale" | "fresh" | "error";
      error?: string;
    };
    serena?: {
      lastActivationAt?: string;
      status: "missing" | "ready" | "error";
      error?: string;
    };
    sandbox?: {
      lastHealthAt?: string;
      status: "missing" | "ready" | "error";
      error?: string;
    };
  };
  downstreams: Record<string, {
    enabled: boolean;
    lastHealthAt?: string;
    status: "unknown" | "ok" | "degraded" | "error";
    error?: string;
  }>;
};
```

## 7.2 Session file

```ts
type AidanaSession = {
  id: string;
  title: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  workspaceId: string;
  backendSessionIds: {
    agentmemory?: string;
    neo4jConversationId?: string;
    neo4jReasoningTraceIds?: string[];
  };
  episodic: {
    goal?: string;
    decisions: string[];
    changedFiles: string[];
    touchedSymbols: string[];
    commands: string[];
    failures: string[];
    tests: string[];
    sandboxRuns: string[];
    nextSteps: string[];
  };
  eventsFile: string;
};
```

## 7.3 Event log

```ts
type AidanaEvent = {
  id: string;
  ts: string;
  sessionId: string;
  requestId?: string;
  type:
    | "tool_start"
    | "tool_success"
    | "tool_error"
    | "downstream_call"
    | "memory_record"
    | "knowledge_record"
    | "symbolic_lookup"
    | "semantic_lookup"
    | "semantic_edit"
    | "diagnostics"
    | "sandbox_run"
    | "session_summary";
  tool?: string;
  durationMs?: number;
  argsSummary?: unknown;
  resultSummary?: unknown;
  touchedFiles?: string[];
  touchedSymbols?: string[];
  error?: string;
};
```

Write rules:

1. Atomic writes for JSON state: temp file then rename.
2. Append-only NDJSON for events.
3. Mutex per workspace state file.
4. No PII removal.
5. Optional credential redaction for logs/events only.
6. Never index binary content.

---

# 8. Current codebase integration plan

The attached server currently contains these key files:

```text
server/mcp-protocol.ts       hardcoded MCP ListTools/CallTool dispatch
server/file-ops.ts           workspace path helpers and simple file/memory tools
server/runtime-config.ts     env/runtime settings for work queue and MCP transport
server/server.ts             defuss RPC work-queue HTTP server
server/work-orchestration.ts in-memory work item queue
```

Do not build a new architecture beside it. Refactor it into layers.

## 8.1 Keep existing work queue

Keep:

```text
server/server.ts
server/work-orchestration.ts
```

These remain the browser automation bridge and legacy tool executor.

Existing tools such as `scrape`, `google_search`, `web_search`, `chatgpt`, `download_file`, etc. become **low-level legacy tools**.

## 8.2 Refactor MCP dispatch

Replace the hardcoded `if (name === ...)` chain in `server/mcp-protocol.ts` with a registry.

New files:

```text
server/context/request-context.ts
server/context/workspace-context.ts

server/config/global-config.ts
server/config/downstream-config.ts
server/config/model-config.ts

server/aidana/state-store.ts
server/aidana/session-store.ts
server/aidana/event-store.ts
server/aidana/credential-redaction.ts
server/aidana/file-filter.ts

server/tools/registry.ts
server/tools/types.ts
server/tools/schemas.ts
server/tools/workspace-tools.ts
server/tools/introspection-tools.ts
server/tools/unified-tools.ts
server/tools/kg-tools.ts
server/tools/mem-tools.ts
server/tools/symbolic-tools.ts
server/tools/semantic-tools.ts
server/tools/proof-tools.ts
server/tools/legacy-tools.ts

server/downstreams/types.ts
server/downstreams/mcp-client-pool.ts
server/downstreams/stdio-client.ts
server/downstreams/http-client.ts

server/adapters/legacy-adapter.ts
server/adapters/neo4j-agent-memory.ts
server/adapters/agentmemory.ts
server/adapters/codegraph.ts
server/adapters/serena-lsp.ts
server/adapters/sandbox.ts

server/llm/openai-compatible-client.ts
server/llm/direct-client.ts
server/llm/proxy-client.ts

server/orchestrator/ask.ts
server/orchestrator/symbolic-ask.ts
server/orchestrator/proof.ts
server/orchestrator/rank.ts
server/orchestrator/capture.ts
server/orchestrator/summarize.ts

server/transport/streamable-http.ts
```

## 8.3 New `mcp-protocol.ts` shape

```ts
export function createMcpProtocolServer(deps: GatewayDeps): Server {
  const mcp = new Server(mcpServerInfo, { capabilities: { tools: {} } });
  const registry = createToolRegistry(deps);

  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: registry.listAnnouncedTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }));

  mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    return deps.capture.captureToolCall(name, args ?? {}, async () => {
      const result = await registry.call(name, args ?? {});
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    });
  });

  return mcp;
}
```

## 8.4 Registry layers

```ts
type ToolVisibility = "announced" | "low_level" | "internal";

type RegisteredTool = {
  name: string;
  description: string;
  inputSchema: object;
  visibility: ToolVisibility;
  source: "aidana" | "legacy" | "agentmemory" | "neo4j" | "codegraph" | "serena" | "sandbox" | "model";
  capabilities: string[];
  sideEffects: "none" | "read" | "write" | "execute" | "network";
  handler: (args: unknown) => Promise<ToolResult<unknown>>;
};
```

`tools/list` returns only `visibility === "announced"`.

`get_all_low_level_tools` returns `visibility === "low_level"` plus optional raw downstream tools.

`call_low_level_tool` invokes `visibility === "low_level"` only.

---

# 9. Request/workspace context

## 9.1 Context types

```ts
type RequestContext = {
  requestId: string;
  headers: Record<string, string>;
  workspace: WorkspaceContext;
  sessionId: string;
  config: EffectiveAidanaConfig;
  recursionDepth: number;
};

type WorkspaceContext = {
  id: string;
  root: string;
  name: string;
  aidanaDir: string;
};
```

## 9.2 Context implementation

Use `AsyncLocalStorage`.

```ts
const requestStore = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext {
  const ctx = requestStore.getStore();
  if (!ctx) throw new Error("RequestContext missing");
  return ctx;
}

export async function withRequestContext<T>(
  headers: Headers,
  fn: () => Promise<T>,
): Promise<T> {
  const ctx = await buildRequestContext(headers);
  return requestStore.run(ctx, fn);
}
```

## 9.3 Workspace resolver

```ts
async function resolveWorkspace(headers: Headers): Promise<WorkspaceContext> {
  const raw = headers.get("x-aidana-workspace");
  if (!raw) throw new GatewayError("WORKSPACE_REQUIRED", "X-Aidana-Workspace is required");
  if (!path.isAbsolute(raw)) throw new GatewayError("WORKSPACE_NOT_ABSOLUTE", raw);

  const root = await fs.realpath(raw);
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new GatewayError("WORKSPACE_NOT_DIRECTORY", root);

  const id = sha256(root).slice(0, 24);
  const aidanaDir = path.join(root, ".aidana");
  await fs.mkdir(aidanaDir, { recursive: true });

  return { id, root, name: path.basename(root), aidanaDir };
}
```

## 9.4 Integrate with existing `file-ops.ts`

Existing `withWorkspacePath(path, fn)` should wrap every MCP request:

```ts
await withRequestContext(headers, async () => {
  const ctx = getRequestContext();
  return withWorkspacePath(ctx.workspace.root, async () => {
    return transport.handleRequest(req, res);
  });
});
```

---

# 10. Downstream MCP client pool

## 10.1 Client keying

Key by:

```text
downstreamId + workspace.id
```

Use per-workspace clients for:

```text
codegraph
serena
sandbox
```

Neo4j and agentmemory may be global but still receive workspace/session identifiers in metadata.

## 10.2 Interface

```ts
class McpClientPool {
  async get(id: DownstreamId, workspace: WorkspaceContext): Promise<McpClient>;
  async call<T>(call: DownstreamCall): Promise<T>;
  async listTools(id: DownstreamId, workspace: WorkspaceContext): Promise<McpTool[]>;
  async health(workspace: WorkspaceContext): Promise<DownstreamHealth[]>;
  async restart(id: DownstreamId, workspace: WorkspaceContext): Promise<void>;
}
```

## 10.3 Downstream call policy

```ts
type DownstreamCall = {
  downstream: DownstreamId;
  tool: string;
  args: unknown;
  timeoutMs?: number;
  retries?: number;
  allowWrite?: boolean;
  allowExecute?: boolean;
};
```

Default timeouts:

```ts
const DEFAULT_TIMEOUTS = {
  legacy: 90_000,
  neo4j: 20_000,
  agentmemory: 20_000,
  codegraph: 30_000,
  serena: 30_000,
  sandbox: 120_000,
  index: 180_000,
  refactor: 120_000,
  web: 120_000,
  research: 600_000,
};
```

---

# 11. Adapter layer

Adapters normalize downstream tools. Superset tools never depend on raw downstream tool names.

## 11.1 Legacy adapter

Wrap existing browser/work-queue tools.

```ts
interface LegacyAdapter {
  scrape(input: ScrapeInput): Promise<unknown>;
  downloadFile(input: DownloadInput): Promise<unknown>;
  googleSearch(input: GoogleSearchInput): Promise<unknown>;
  webSearch(input: WebSearchInput): Promise<unknown>;
  consensus(input: ConsensusInput): Promise<unknown>;
  chatgpt(input: ChatGptInput): Promise<unknown>;
  callExistingTool(name: string, args: unknown): Promise<unknown>;
}
```

Register all existing hardcoded tools as low-level.

## 11.2 AgentMemory adapter

```ts
interface AgentMemoryAdapter {
  health(): Promise<Health>;
  ensureWorkspace(ctx: WorkspaceContext): Promise<void>;
  recall(input: { query: string; workspaceId: string; sessionId?: string; limit?: number }): Promise<Evidence[]>;
  record(input: { kind: string; text: string; workspaceId: string; sessionId: string; metadata?: Record<string, unknown> }): Promise<{ memoryId: string }>;
  sessions(input: { workspaceId: string; query?: string; limit?: number }): Promise<SessionSummary[]>;
  timeline(input: { sessionId: string; limit?: number }): Promise<Evidence[]>;
  closeSession(input: { sessionId: string; summary: string }): Promise<void>;
}
```

## 11.3 Neo4j Agent Memory adapter

```ts
interface Neo4jMemoryAdapter {
  health(): Promise<Health>;
  ensureWorkspace(ctx: WorkspaceContext): Promise<void>;
  find(input: { query: string; limit?: number; types?: string[]; memory?: KgMemoryOptions }): Promise<Evidence[]>;
  ask(input: { question: string; memory?: KgMemoryOptions }): Promise<AnswerDraft>;
  put(input: { text: string; source?: string; tags?: string[]; writeMode?: string; extraction?: object; memory?: object }): Promise<{ entities: Evidence[]; relationships: Evidence[] }>;
  link(input: { from: EntityRef; relation: string; to: EntityRef; provenance?: Provenance }): Promise<Evidence>;
  queryReadOnly(input: { query: string; params?: Record<string, unknown>; memory?: object }): Promise<Evidence[]>;
  context(input: { target: string; purpose?: string; memory?: KgMemoryOptions; budgetTokens?: number }): Promise<Evidence[]>;
  review(input: { reviewType: string; memory?: KgMemoryOptions }): Promise<Evidence[]>;
}
```

## 11.4 CodeGraph adapter

```ts
interface CodeGraphAdapter {
  health(): Promise<Health>;
  sync(input?: { full?: boolean }): Promise<IndexStatus>;
  find(input: { query: string; limit?: number; kind?: string }): Promise<SymbolicEvidence[]>;
  context(input: { target: string; budgetTokens?: number }): Promise<SymbolicContext>;
  impact(input: { target: string; depth?: number; includeTests?: boolean }): Promise<ImpactGraph>;
  path(input: { from: string; to: string }): Promise<SymbolicPath[]>;
  map(input: { scope?: string; depth?: number }): Promise<SymbolicMap>;
  diff(input: { staged?: boolean; unstaged?: boolean }): Promise<DiffImpact>;
}
```

## 11.5 Serena LSP adapter

No JetBrains support.

```ts
interface SerenaLspAdapter {
  health(): Promise<Health>;
  activateProject(): Promise<void>;
  restart(): Promise<void>;
  definition(input: { symbol: string; path?: string; includeBody?: boolean }): Promise<SymbolicEvidence[]>;
  references(input: { symbol: string; path?: string; includeDeclaration?: boolean }): Promise<SymbolicEvidence[]>;
  implementations(input: { symbol: string; path?: string }): Promise<SymbolicEvidence[]>;
  diagnostics(input: { path?: string; symbol?: string; scope?: "file" | "workspace" }): Promise<DiagnosticEvidence[]>;
  rename(input: { symbol: string; path?: string; newName: string }): Promise<EditResult>;
  edit(input: { symbol: string; path?: string; operation: string; content: string }): Promise<EditResult>;
  safeDelete(input: { symbol: string; path?: string }): Promise<DeletePlan | EditResult>;
}
```

Expected raw Serena tool mapping:

```text
activateProject       -> activate_project
definition            -> find_symbol / find_declaration
references            -> find_referencing_symbols
implementations       -> find_implementations
diagnostics           -> get_diagnostics / get_diagnostics_for_file
rename                -> rename_symbol
edit replace_body     -> replace_symbol_body
edit insert_before    -> insert_before_symbol
edit insert_after     -> insert_after_symbol
restart               -> restart_language_server
```

## 11.6 Sandbox adapter

Adapt `philschmid/code-sandbox-mcp` into an Aidana-aware sandbox server.

```ts
interface SandboxAdapter {
  health(): Promise<Health>;
  run(input: SandboxRunInput): Promise<SandboxRunResult>;
  listRuns(input?: { limit?: number }): Promise<SandboxRunSummary[]>;
  getRun(input: { runId: string }): Promise<SandboxRunResult>;
  cleanup(input?: { olderThanHours?: number }): Promise<void>;
}
```

The sandbox adapter must:

1. Run code inside a container.
2. Volume-mount the current Aidana workspace.
3. Mount `.aidana/sandbox/` for artifacts/runs.
4. Inject Aidana MCP connection env vars.
5. Provide Python and JavaScript helper libraries for calling Aidana MCP from inside the container.
6. After execution, optionally run Serena diagnostics and symbolic diff on touched files.
7. Return stdout, stderr, exit code, artifacts, touched files, diagnostics, and symbolic diff.

---

# 12. REPL/RLM sandbox design

## 12.1 Base implementation

Clone and adapt:

```text
https://github.com/philschmid/code-sandbox-mcp
```

Treat it as a starting point only.

Required Aidana changes:

```text
1. Add workspace volume mount.
2. Add sandbox run state under <workspace>/.aidana/sandbox/.
3. Add Aidana MCP helper libraries inside container.
4. Add post-run diagnostics through Aidana gateway.
5. Add post-run symbolic diff through Aidana gateway.
6. Add recursion-depth headers for nested smart tool calls.
7. Add binary/large-file skip logic for artifact capture.
8. Add deterministic execution controls: timeout, seed env, package allow policy.
```

## 12.2 Container mounts

Host:

```text
/workspace-host = X-Aidana-Workspace realpath
```

Container:

```text
/workspace
/aidana
```

Mounts:

```text
${workspace}                 -> /workspace
${workspace}/.aidana/sandbox -> /aidana
```

Environment inside container:

```bash
AIDANA_MCP_URL="http://host.docker.internal:3211/mcp"
AIDANA_HOST_WORKSPACE="/absolute/host/workspace"
AIDANA_CONTAINER_WORKSPACE="/workspace"
AIDANA_SESSION_ID="..."
AIDANA_REQUEST_ID="..."
AIDANA_RECURSION_DEPTH="1"
```

Linux fallback for host networking:

```text
if host.docker.internal unavailable:
  use Docker gateway host, commonly 172.17.0.1
or run container with --add-host=host.docker.internal:host-gateway
```

## 12.3 Inside-container MCP helper

Provide:

```text
/aidana/helpers/aidana_tools.py
/aidana/helpers/aidana_tools.mjs
```

Python helper sketch:

```python
from aidana_tools import aidana_call

refs = aidana_call("sem_refs", {"symbol": "MyClass"})
print(refs)
```

Helper behavior:

1. Calls `AIDANA_MCP_URL`.
2. Sends `X-Aidana-Workspace = AIDANA_HOST_WORKSPACE`.
3. Sends `X-Aidana-SessionId`.
4. Sends incremented `X-Aidana-RecursionDepth`.
5. Uses MCP `tools/call` over Streamable HTTP.

## 12.4 Post-run feedback

When `proof_run.afterRun.diagnostics === true`:

```text
1. Detect touched files from git diff or filesystem mtime under workspace.
2. Run sem_diag for touched files.
3. Include diagnostics in proof_run result.
```

When `proof_run.afterRun.symbolicDiff === true`:

```text
1. Run sym_diff.
2. Include impact summary.
```

When `captureArtifacts === true`:

```text
1. Collect files under /aidana/artifacts/<runId>/.
2. Skip binary and >1MB text capture.
3. Return artifact metadata and relative paths.
```

## 12.5 REPL/RLM use cases

Minimum supported use cases:

```text
1. Prove an algorithm by simulation.
2. Verify a formula numerically/symbolically where possible.
3. Generate a one-off data transform script over workspace files.
4. Run a smoke test against generated code.
5. Execute a Markdown/document transformation script.
6. Let sandbox code call Aidana tools for semantic feedback.
```

---

# 13. File filtering, binary detection, and indexing guards

No PII removal by default.

But indexing must avoid garbage, binaries, huge files, and dependency directories.

## 13.1 Exclude path patterns

Default exclude regexp/list:

```ts
const DEFAULT_EXCLUDED_PATH_PARTS = [
  ".git",
  ".hg",
  ".svn",
  ".aidana/cache",
  ".aidana/tmp",
  ".aidana/sandbox/runs",
  "node_modules",
  "bower_components",
  "vendor",
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  ".parcel-cache",
  "coverage",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".venv",
  "venv",
  "env",
  ".tox",
  ".gradle",
  ".idea",
  ".vscode",
  "DerivedData",
  ".build",
  "Pods",
  ".terraform",
  ".serverless"
];
```

Default excluded file regex:

```ts
const DEFAULT_EXCLUDED_FILE_RE = /(^|\/)(\.env(\..*)?|.*\.pem|.*\.key|.*\.p12|.*\.pfx|.*\.sqlite|.*\.db|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|go\.sum)$/i;
```

Lockfiles may be excluded from embedding/indexing by default but still readable by explicit file tools if requested.

## 13.2 Indexing gate order

For any automatic indexing/embedding/memory ingestion:

```text
1. Check path is inside workspace.
2. Check excluded directory/file patterns.
3. Check regular file.
4. Check file size <= 1 MB.
5. Run binary detector on first 8-64 KB.
6. If binary -> skip.
7. Only now read text.
8. Only now parse/index/embed/extract.
```

## 13.3 Binary detector

```ts
function looksBinary(buf: Buffer): boolean {
  if (buf.includes(0)) return true;

  const sample = buf.subarray(0, Math.min(buf.length, 64 * 1024));
  const decoded = sample.toString("utf8");
  const replacementCount = [...decoded].filter((ch) => ch === "\uFFFD").length;
  if (replacementCount > Math.max(1, decoded.length * 0.01)) return true;

  let control = 0;
  for (const byte of sample) {
    const allowed = byte === 9 || byte === 10 || byte === 13 || byte >= 32;
    if (!allowed) control++;
  }
  return control > sample.length * 0.05;
}
```

## 13.4 Credential redaction

No PII removal.

Credential redaction is only for logs/events, not source files and not user-owned workspace documents.

Config:

```bash
AIDANA_CREDENTIAL_REDACTION=1   # default 1
```

If disabled, logs/events are written as-is.

Future optional tool:

```text
remove_pii
```

This can later call GLiNER2 or another NER model. Not part of the required implementation.

---

# 14. LLM clients

## 14.1 OpenAI-compatible client only

No provider-specific abstraction is required for now.

```ts
class OpenAICompatibleClient {
  constructor(config: {
    endpoint: string;
    apiKey?: string;
    model: string;
    defaultParams?: Record<string, unknown>;
  });

  chat(input: ChatInput): Promise<ChatOutput>;
  embed(input: EmbedInput): Promise<number[]>;
}
```

## 14.2 Effective LLM config

```ts
type EffectiveAidanaConfig = {
  llm: {
    direct: {
      endpoint: string;
      apiKey?: string;
      model: string;
    };
    proxy: {
      endpoint: string;
      apiKey?: string;
      model: string;
    };
    mode: "direct" | "proxy" | "auto";
    params: {
      temperature?: number;
      maxTokens?: number;
      topP?: number;
      topK?: number;
      seed?: number;
      presencePenalty?: number;
      frequencyPenalty?: number;
      repetitionPenalty?: number;
      enableThinking?: boolean;
    };
  };
  embedding: {
    endpoint: string;
    apiKey?: string;
    model: string;
  };
  extraction: {
    nerModel?: string;
    relationModel?: string;
    rerankModel?: string;
  };
};
```

## 14.3 LLM mode selection

```text
direct:
  Use backend LLM directly.
  Cannot call Aidana MCP itself.

proxy:
  Use glitcr smart proxy on localhost.
  It can call Aidana MCP recursively.

auto:
  Direct for cheap/simple calls.
  Proxy for complex multi-tool calls or explicit recursive tool use.
```

Rule:

```text
Never use proxy mode if X-Aidana-RecursionDepth >= maxRecursionDepth.
```

---

# 15. Ask orchestration

## 15.1 Intent classifier

First use cheap deterministic heuristics.

```ts
type AskIntent =
  | "knowledge"
  | "session"
  | "symbolic"
  | "semantic"
  | "web"
  | "research"
  | "repl-proof"
  | "mixed";
```

Heuristics:

```text
"last session", "remember", "what did we do" -> session
"what do we know", "facts", "preference", "decision", "wiki" -> knowledge
"where is", "implemented", "file", "symbol", "module", "heading" -> symbolic
"references", "rename", "diagnostics", "definition" -> semantic
"latest", "search web", "current", "news", "price" -> web/research
"prove", "simulate", "run code", "verify formula", "test algorithm" -> repl-proof
otherwise -> mixed
```

If low confidence, use direct LLM classifier.

## 15.2 Retrieval plan

For `ask(mode="auto")`:

```text
1. Classify query.
2. Build execution plan.
3. Run cheap retrieval in parallel where safe:
   - Neo4j kg_find/kg_context
   - agentmemory mem_recall
   - CodeGraph sym_find/sym_ctx
   - legacy web_search/google_search if web requested/needed
4. Use Serena only when exact semantic targets exist or semantic mode requested.
5. Use sandbox only when proof/execution requested or required.
6. Rank evidence.
7. Synthesize answer.
8. Record useful session memory.
```

## 15.3 Web/research mode

Use existing low-level browser/work-queue tools.

Route order:

```text
simple fresh fact:
  google_search -> scrape top pages -> direct synthesis

scientific/academic consensus:
  consensus -> web_search -> direct/proxy synthesis

needs deep external reasoning:
  chatgpt low-level or future deep-research tools -> synthesis

calculation/proof needed:
  proof_run or external calculator/Wolfram future tool
```

## 15.4 REPL-proof mode

Route:

```text
1. Ask direct/proxy LLM to produce proof plan and code.
2. Run code in sandbox.
3. If code touches workspace, run sem_diag and sym_diff.
4. If algorithmic claim, run multiple randomized/property tests.
5. Return result with stdout/stderr/artifacts and confidence.
```

## 15.5 Mixed mode examples

| User asks | Route |
|---|---|
| “What did we decide about the LLM proxy and where is it configured?” | Neo4j long_term + agentmemory + sym_find |
| “Can this formula be correct?” | proof_run + direct synthesis |
| “Where in the docs do we describe Serena?” | sym_find Markdown + sym_ctx + optional sem_def if LSP supports |
| “What changed after the previous session?” | mem_timeline + sym_diff |
| “Does this current claim need web verification?” | web_search + proof_run if numerical |

---

# 16. Common result envelope

Every public tool returns JSON text shaped as:

```ts
type ToolResult<T> = {
  ok: boolean;
  workspace: {
    id: string;
    root: string;
    name: string;
  };
  sessionId: string;
  requestId: string;
  tool: string;
  confidence?: number;
  data?: T;
  evidence?: Evidence[];
  backendTrace: BackendTrace[];
  warnings?: string[];
  error?: {
    code: string;
    message: string;
    backend?: string;
    details?: unknown;
  };
};

type BackendTrace = {
  backend: "aidana" | "legacy" | "neo4j" | "agentmemory" | "codegraph" | "serena" | "sandbox" | "model";
  tool?: string;
  latencyMs: number;
  ok: boolean;
  error?: string;
};

type Evidence = {
  kind:
    | "file"
    | "symbol"
    | "heading"
    | "diagnostic"
    | "session"
    | "memory"
    | "entity"
    | "relationship"
    | "query"
    | "diff"
    | "impact"
    | "web"
    | "sandbox"
    | "artifact";
  backend: "aidana" | "legacy" | "neo4j" | "agentmemory" | "codegraph" | "serena" | "sandbox" | "model";
  id?: string;
  score?: number;
  path?: string;
  lineStart?: number;
  lineEnd?: number;
  symbol?: string;
  sessionId?: string;
  nodeId?: string;
  url?: string;
  excerpt?: string;
  metadata?: Record<string, unknown>;
};
```

---

# 17. Session capture

Wrap every announced and low-level tool call.

```ts
async function captureToolCall<T>(
  name: string,
  args: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  const ctx = getRequestContext();
  const start = Date.now();

  await eventStore.append({
    type: "tool_start",
    tool: name,
    argsSummary: summarizeArgs(args),
  });

  try {
    const result = await fn();
    const summary = summarizeResult(result);

    await eventStore.append({
      type: "tool_success",
      tool: name,
      durationMs: Date.now() - start,
      resultSummary: summary,
      touchedFiles: extractFiles(result),
      touchedSymbols: extractSymbols(result),
    });

    await maybeRecordToAgentMemory(name, args, result);
    await maybeRecordToNeo4j(name, args, result);

    return result;
  } catch (error) {
    await eventStore.append({
      type: "tool_error",
      tool: name,
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
```

Record to agentmemory when:

```text
mem_note called
sem_rename/sem_edit/sem_delete succeeds or fails
proof_run executes
sym_diff/sym_impact answers a change question
tool error occurs
ask produces a durable plan/decision
session closes
```

Record to Neo4j when:

```text
kg_put called
long-term fact/decision/preference extracted
reasoning trace is useful and durable
workspace Wiki/document knowledge extracted
```

---

# 18. Milestones with checkbox task lists and end-to-end tests

Every milestone must include real localhost tests. Unit tests alone are not enough.

Use this test workspace:

```text
tmp/aidana-e2e-workspace/
  README.md
  docs/architecture.md
  src/math.ts
  src/math.test.ts
  src/service.ts
  package.json
```

Create at least:

```ts
export function add(a: number, b: number): number { return a + b; }
export function fib(n: number): number { return n <= 1 ? n : fib(n - 1) + fib(n - 2); }
```

and Markdown headings:

```md
# Aidana Architecture
## LLM Proxy
## Memory Tiers
```

---

## Milestone 1 — Config, context, auth, workspace state

### Tasks

- [ ] Implement `server/config/global-config.ts`.
- [ ] Read `~/.aidana/config.json`.
- [ ] Derive direct LLM config from `llm.endpoint`, `llm.model`, `llm.apiKey`.
- [ ] Derive proxy LLM config from `llm.proxy.port` and same model/apiKey.
- [ ] Read `~/.aidana/mcp.json`.
- [ ] Implement `server/config/downstream-config.ts`.
- [ ] Read `~/.aidana/downstream.config.json`.
- [ ] Implement `server/context/request-context.ts`.
- [ ] Require `X-Aidana-Workspace`.
- [ ] Reject `X-Aidata-*`; do not implement alias.
- [ ] Validate workspace path is absolute.
- [ ] Resolve workspace with `realpath`.
- [ ] Create `<workspace>/.aidana/` directories.
- [ ] Implement optional `X-Aidana-ApiKey` auth.
- [ ] Implement header model overrides.
- [ ] Implement recursion depth parse and default.
- [ ] Implement `.aidana/state.json` init.
- [ ] Implement `.aidana/sessions/<id>.json` init.
- [ ] Implement event-store append.

### End-to-end tests

- [ ] Start Aidana on localhost.
- [ ] Call `ws_status` without `X-Aidana-Workspace`; expect `WORKSPACE_REQUIRED`.
- [ ] Call `ws_status` with relative workspace; expect `WORKSPACE_NOT_ABSOLUTE`.
- [ ] Call `ws_status` with valid absolute workspace; expect `.aidana/state.json` exists.
- [ ] Set `AIDANA_API_KEY=test-key`, call without header; expect `UNAUTHORIZED`.
- [ ] Call with `X-Aidana-ApiKey: test-key`; expect success.
- [ ] Override `X-Aidana-LLM-Endpoint` and verify `ws_status.verbose` reports effective endpoint.

### Proof of operation

`ws_status` must return:

```text
ok=true
workspace.root=<absolute path>
sessionId=<created or resumed>
config.llm.direct.endpoint=<from disk or header>
```

---

## Milestone 2 — Registry refactor and legacy tool integration

### Tasks

- [ ] Implement `server/tools/registry.ts`.
- [ ] Add `visibility: announced | low_level | internal`.
- [ ] Refactor `server/mcp-protocol.ts` to use registry.
- [ ] Register `ws_status` as announced.
- [ ] Register `ws_sync` as announced.
- [ ] Register `get_all_low_level_tools` as announced.
- [ ] Register `call_low_level_tool` as announced.
- [ ] Move existing hardcoded MCP branches to `legacy-tools.ts`.
- [ ] Register memory file tools as low-level.
- [ ] Register scrape/download/google/consensus/web/chatgpt tools as low-level.
- [ ] Register `allMcpTools` fallback tools as low-level.
- [ ] Preserve old behavior behind `call_low_level_tool`.
- [ ] Add low-level tool cache under `.aidana/cache/low-level-tools.json`.

### End-to-end tests

- [ ] `tools/list` includes `ws_status`, `ask`, `get_all_low_level_tools`, `call_low_level_tool` once implemented/stubbed.
- [ ] `tools/list` does **not** include raw `web_search`.
- [ ] `get_all_low_level_tools` returns `legacy.web_search` and `legacy.scrape`.
- [ ] `call_low_level_tool({name:"legacy.memory_file_save", ...})` writes memory file.
- [ ] `call_low_level_tool({name:"legacy.memory_file_read", ...})` reads same file.

### Proof of operation

Low-level legacy tools must be callable without being announced in standard MCP list.

---

## Milestone 3 — Streamable HTTP transport and CORS

### Tasks

- [ ] Implement `server/transport/streamable-http.ts`.
- [ ] Keep existing work-queue server intact.
- [ ] Wrap MCP HTTP request in `withRequestContext`.
- [ ] Wrap existing file ops with `withWorkspacePath`.
- [ ] Implement `/healthz` endpoint.
- [ ] Implement CORS origin allow function.
- [ ] Include all `X-Aidana-*` headers in preflight.
- [ ] Support MCP session headers.
- [ ] Test from localhost browser-origin request.

### End-to-end tests

- [ ] Start server with `AIDANA_MCP_TRANSPORT=http`.
- [ ] Run MCP `tools/list` via HTTP.
- [ ] Run MCP `tools/call ws_status` via HTTP.
- [ ] Send `Origin: http://localhost:3000`; expect allowed.
- [ ] Send `Origin: http://127.0.0.1:5173`; expect allowed.
- [ ] Send `Origin: http://10.0.0.5:8080`; expect allowed.
- [ ] Send `Origin: http://example.com`; expect not allowed.

### Proof of operation

A local browser-based Swift/Web UI bridge can call the MCP endpoint with custom headers.

---

## Milestone 4 — Downstream MCP client pool

### Tasks

- [ ] Implement stdio MCP client.
- [ ] Implement Streamable HTTP MCP client.
- [ ] Load downstream definitions from `~/.aidana/downstream.config.json`.
- [ ] Expand `${workspace}` variables.
- [ ] Expand `${aidanaMcpUrl}` from `~/.aidana/mcp.json`.
- [ ] Implement `listTools` discovery.
- [ ] Implement `call` with timeout and retries.
- [ ] Implement `health`.
- [ ] Implement `restart`.
- [ ] Cache raw tool manifests under `.aidana/cache/downstream-tools.json`.
- [ ] Add backend trace collection.

### End-to-end tests

- [ ] Configure one fake stdio MCP downstream with `echo` tool.
- [ ] Configure one fake HTTP MCP downstream with `ping` tool.
- [ ] `ws_sync` discovers both.
- [ ] `get_all_low_level_tools` lists both fake tools.
- [ ] `call_low_level_tool` invokes both fake tools.
- [ ] Kill fake stdio process; `ws_status` reports degraded/error.
- [ ] `restart` via pool recovers fake stdio process.

### Proof of operation

Aidana can host both stdio and Streamable HTTP downstream MCP servers.

---

## Milestone 5 — File filtering and indexing guards

### Tasks

- [ ] Implement `server/aidana/file-filter.ts`.
- [ ] Add default excluded path parts.
- [ ] Add excluded file regex.
- [ ] Implement size gate `<= 1 MB`.
- [ ] Implement binary detector.
- [ ] Ensure automatic indexers use file filter.
- [ ] Ensure sandbox artifact capture uses file filter.
- [ ] Ensure memory/document ingestion uses file filter.
- [ ] Add config override later, but defaults first.

### End-to-end tests

- [ ] Create `node_modules/foo/index.js`; verify skipped by index scan.
- [ ] Create `.env`; verify skipped by automatic index scan.
- [ ] Create `large.md` > 1 MB; verify skipped.
- [ ] Create `binary.bin` with NUL bytes; verify skipped.
- [ ] Create `docs/architecture.md`; verify accepted.
- [ ] Create `src/math.ts`; verify accepted.

### Proof of operation

Automatic indexing never reads binaries, huge files, or dependency folders.

---

## Milestone 6 — LLM direct/proxy clients

### Tasks

- [ ] Implement OpenAI-compatible chat client.
- [ ] Implement OpenAI-compatible embedding client.
- [ ] Implement direct client using `~/.aidana/config.json llm.endpoint`.
- [ ] Implement proxy client using `http://127.0.0.1:${llm.proxy.port}/v1`.
- [ ] Implement request-level header overrides.
- [ ] Implement `X-Aidana-LLM-Mode`.
- [ ] Implement recursion depth guard.
- [ ] Add low-level model tools: `model.direct_chat`, `model.proxy_chat`, `model.embed`.
- [ ] Do not add provider-specific logic.

### End-to-end tests

- [ ] Start local OpenAI-compatible mock server.
- [ ] `model.direct_chat` sends request to configured backend endpoint.
- [ ] `model.proxy_chat` sends request to localhost proxy port.
- [ ] Header override changes endpoint for one call only.
- [ ] `X-Aidana-RecursionDepth` above max blocks proxy mode.
- [ ] Embedding request uses configured embedding endpoint/model.

### Proof of operation

A tool can choose direct or smart/proxy LLM path deterministically.

---

## Milestone 7 — CodeGraph symbolic adapter/tools

### Tasks

- [ ] Implement `CodeGraphAdapter`.
- [ ] Discover raw CodeGraph tools dynamically.
- [ ] Register raw CodeGraph tools as low-level.
- [ ] Implement `sym_index`.
- [ ] Implement `sym_find`.
- [ ] Implement `sym_ctx`.
- [ ] Implement `sym_impact`.
- [ ] Implement `sym_path`.
- [ ] Implement `sym_map`.
- [ ] Implement `sym_diff`.
- [ ] Update `.aidana/state.json indexes.symbolic`.
- [ ] Support Markdown/text-like files if CodeGraph exposes them.

### End-to-end tests

- [ ] In test workspace, run `sym_index`.
- [ ] `sym_find({query:"fib"})` returns `src/math.ts`.
- [ ] `sym_ctx({target:"fib"})` returns source context.
- [ ] `sym_find({query:"LLM Proxy"})` finds `docs/architecture.md` heading or file if supported.
- [ ] Modify `src/math.ts`; `sym_diff` reports change impact.
- [ ] `get_all_low_level_tools` includes raw CodeGraph tools.

### Proof of operation

Broad symbolic lookup works across supported workspace file types.

---

## Milestone 8 — Serena LSP adapter/tools

### Tasks

- [ ] Implement `SerenaLspAdapter`.
- [ ] Start Serena LSP downstream with project path.
- [ ] Discover raw Serena tools dynamically.
- [ ] Assert no JetBrains tools are used.
- [ ] Register raw Serena tools as low-level.
- [ ] Implement `sem_def`.
- [ ] Implement `sem_refs`.
- [ ] Implement `sem_impls`.
- [ ] Implement `sem_diag`.
- [ ] Implement `sem_restart`.
- [ ] Implement `sem_rename` with dry run.
- [ ] Implement `sem_edit` with dry run.
- [ ] Implement `sem_delete` guarded by references.
- [ ] Update `.aidana/state.json indexes.serena`.

### End-to-end tests

- [ ] `ws_sync` activates Serena on test workspace.
- [ ] `sem_def({symbol:"fib"})` returns exact definition.
- [ ] `sem_refs({symbol:"fib"})` returns test/reference file.
- [ ] Introduce TypeScript error; `sem_diag` reports it.
- [ ] `sem_rename({symbol:"add", newName:"sum", dryRun:true})` returns plan only.
- [ ] `sem_rename({symbol:"add", newName:"sum"})` changes references.
- [ ] `sem_diag` after rename has no new errors.
- [ ] `get_all_low_level_tools` includes raw Serena LSP tools and no JetBrains tools.

### Proof of operation

Precise semantic lookup and rename work through LSP only.

---

## Milestone 9 — agentmemory chat-session adapter/tools

### Tasks

- [ ] Implement `AgentMemoryAdapter`.
- [ ] Map Aidana session IDs to agentmemory session IDs.
- [ ] Register raw agentmemory tools as low-level.
- [ ] Implement `mem_note`.
- [ ] Implement `mem_recall`.
- [ ] Implement `mem_sessions`.
- [ ] Implement `mem_timeline`.
- [ ] Implement `mem_resume`.
- [ ] Implement `mem_close`.
- [ ] Implement automatic session capture.
- [ ] Update `.aidana/state.json recentSessionIds`.
- [ ] Update `.aidana/sessions/<sessionId>.json` summaries.

### End-to-end tests

- [ ] `mem_note({text:"Project prefers proxy LLM for recursive tool use"})` stores note.
- [ ] `mem_recall({query:"proxy LLM"})` retrieves note.
- [ ] Run two tool calls; `mem_timeline` shows both.
- [ ] `mem_close` writes summary and closes session.
- [ ] Start new request without session header; `mem_resume` returns recent session context.
- [ ] `get_all_low_level_tools` includes raw agentmemory tools.

### Proof of operation

Chat-session continuity works independently of coding-specific assumptions.

---

## Milestone 10 — Neo4j Agent Memory adapter/tools

### Tasks

- [ ] Implement `Neo4jMemoryAdapter`.
- [ ] Register raw Neo4j memory tools as low-level.
- [ ] Implement explicit `KgMemoryOptions`.
- [ ] Implement `kg_find`.
- [ ] Implement `kg_ask`.
- [ ] Implement `kg_put`.
- [ ] Implement `kg_link`.
- [ ] Implement `kg_query` with read-only guard.
- [ ] Implement `kg_context`.
- [ ] Implement `kg_review`.
- [ ] Ensure short_term/long_term/reasoning tier selection is passed through or enforced.
- [ ] Store workspace entity in Neo4j.
- [ ] Store useful Wiki-like Markdown facts from workspace when requested.

### End-to-end tests

- [ ] `kg_put` with `writeMode:"long_term_knowledge"` stores fact: “Aidana uses X-Aidana-Workspace”.
- [ ] `kg_ask` with `tiers:["long_term"]` retrieves the fact.
- [ ] `kg_put` with `writeMode:"short_term_message"` stores a message.
- [ ] `kg_ask` with `tiers:["short_term"]` retrieves message context.
- [ ] `kg_put` with `writeMode:"reasoning_trace"` stores a tool/outcome summary.
- [ ] `kg_ask` with `tiers:["reasoning"]` retrieves how/outcome context.
- [ ] `kg_ask` with `fusion:"cross_tier"` answers a provenance question.
- [ ] `kg_query` rejects `CREATE`, `MERGE`, `DELETE`, `SET`, `REMOVE`.
- [ ] `get_all_low_level_tools` includes raw Neo4j tools.

### Proof of operation

All three Neo4j memory tiers are explicitly usable from `kg_*` calls.

---

## Milestone 11 — REPL/RLM sandbox adapter/tools

### Tasks

- [ ] Clone/adapt `philschmid/code-sandbox-mcp`.
- [ ] Rename internal package/server to Aidana sandbox if desired.
- [ ] Add workspace volume mount.
- [ ] Add `.aidana/sandbox` volume mount.
- [ ] Inject Aidana MCP URL and workspace env vars.
- [ ] Add Python helper `aidana_tools.py`.
- [ ] Add JS helper `aidana_tools.mjs`.
- [ ] Implement sandbox run metadata capture.
- [ ] Implement artifact capture with file filter.
- [ ] Implement post-run `sem_diag`.
- [ ] Implement post-run `sym_diff`.
- [ ] Register raw sandbox tools as low-level.
- [ ] Implement high-level `proof_run`.
- [ ] Add timeout and recursion guard.

### End-to-end tests

- [ ] `proof_run` executes Python `print(1+1)` and returns stdout `2`.
- [ ] `proof_run` executes JS `console.log(1+1)` and returns stdout `2`.
- [ ] Python script writes `/workspace/generated.md`; host workspace sees file.
- [ ] `afterRun.diagnostics=true` returns diagnostics for touched TypeScript files.
- [ ] Python script imports `aidana_tools` and calls `ws_status` through Aidana MCP.
- [ ] Sandbox run with infinite loop times out.
- [ ] Artifact >1MB is not captured as text.
- [ ] Binary artifact is skipped.

### Proof of operation

Sandbox code can execute against mounted workspace and call Aidana tools from inside container.

---

## Milestone 12 — Unified `ask` and `code_ask`/symbolic ask

### Tasks

- [ ] Implement heuristic intent classifier.
- [ ] Implement optional direct LLM classifier fallback.
- [ ] Implement `ask` execution planner.
- [ ] Implement evidence ranking.
- [ ] Implement direct/proxy synthesis selector.
- [ ] Implement web mode using legacy tools.
- [ ] Implement research mode using legacy + model synthesis.
- [ ] Implement repl-proof mode using `proof_run`.
- [ ] Implement symbolic mode using CodeGraph.
- [ ] Implement semantic verification via Serena.
- [ ] Implement session augmentation via agentmemory.
- [ ] Implement knowledge augmentation via Neo4j.
- [ ] Implement `code_ask` compatibility wrapper over symbolic/semantic plan.
- [ ] Ensure outputs include backend traces and evidence.

### End-to-end tests

- [ ] `ask({question:"What do we know about X-Aidana-Workspace?"})` routes to Neo4j after fact is stored.
- [ ] `ask({question:"What did we do last session?"})` routes to agentmemory.
- [ ] `ask({question:"Where is fib implemented?"})` routes to CodeGraph + Serena.
- [ ] `ask({question:"Find references to fib"})` routes to Serena.
- [ ] `ask({question:"Prove fib(10)=55 by running code", mode:"repl-proof"})` runs sandbox.
- [ ] `ask({question:"Search the web for ...", mode:"web"})` invokes legacy web tools.
- [ ] `code_ask({question:"Where is add used?"})` returns source/test files.

### Proof of operation

One high-level tool can route across memory, symbolic lookup, semantic lookup, web, and sandbox execution.

---

## Milestone 13 — Low-level self-orchestration and recursive smart tools

### Tasks

- [ ] Ensure `get_all_low_level_tools` lists all legacy and downstream raw tools.
- [ ] Ensure low-level names are stable and namespaced.
- [ ] Implement `call_low_level_tool` side-effect policy.
- [ ] Implement model proxy recursion guard.
- [ ] Implement sandbox helper MCP calls.
- [ ] Add `X-Aidana-RecursionDepth` propagation to low-level tool calls.
- [ ] Add `X-Aidana-SessionId` propagation.
- [ ] Ensure proxy LLM can call Aidana MCP through `~/.aidana/mcp.json`.
- [ ] Add loop-detection for repeated same tool+args within same request chain.

### End-to-end tests

- [ ] Ask proxy LLM to call `get_all_low_level_tools`; verify result.
- [ ] Ask proxy LLM to call a low-level memory tool; verify success.
- [ ] Recursive call depth 0 -> 1 -> 2 succeeds.
- [ ] Recursive call beyond max returns `RECURSION_LIMIT`.
- [ ] Sandbox code calls `call_low_level_tool` for `legacy.memory_file_save`.
- [ ] Looping recursive prompt is stopped by loop detection.

### Proof of operation

Agents can build custom orchestration on top of low-level tool enumeration while recursion remains controlled.

---

## Milestone 14 — Hardening, observability, and docs

### Tasks

- [ ] Add structured logs under `.aidana/logs/gateway.ndjson`.
- [ ] Add backend trace to every result.
- [ ] Add timing metrics to every adapter call.
- [ ] Add config summary to `ws_status` without leaking secrets unless redaction disabled.
- [ ] Add developer README.
- [ ] Add low-level tool naming convention docs.
- [ ] Add troubleshooting docs for Serena, CodeGraph, Neo4j, agentmemory, sandbox.
- [ ] Add migration docs from previous `code_*` names to `sym_*`.
- [ ] Add schema version migration for `.aidana/state.json`.

### End-to-end tests

- [ ] Kill CodeGraph downstream; `ask` returns degraded warning, not crash.
- [ ] Kill Serena downstream; semantic tools return backend error.
- [ ] Invalid `~/.aidana/config.json` returns actionable config error.
- [ ] Invalid downstream config returns actionable config error.
- [ ] `ws_status(verbose:true)` shows healthy/degraded backends.
- [ ] Logs contain request IDs and backend traces.

### Proof of operation

Failures are diagnosable and isolated by backend.

---

## Milestone 15 — Full localhost acceptance suite

Create `tests/e2e/full-localhost.test.ts`.

### Required scenarios

- [ ] Start Aidana MCP server on `127.0.0.1:3211`.
- [ ] Create temp workspace.
- [ ] Write sample TypeScript and Markdown files.
- [ ] Call `ws_sync`.
- [ ] Store long-term fact with `kg_put`.
- [ ] Retrieve it with `kg_ask`.
- [ ] Store session note with `mem_note`.
- [ ] Retrieve it with `mem_recall`.
- [ ] Index workspace with `sym_index`.
- [ ] Find symbol with `sym_find`.
- [ ] Find definition with `sem_def`.
- [ ] Find references with `sem_refs`.
- [ ] Run diagnostics with `sem_diag`.
- [ ] Run proof script with `proof_run`.
- [ ] Enumerate low-level tools.
- [ ] Call one low-level legacy tool.
- [ ] Call one low-level downstream tool.
- [ ] Run `ask` for knowledge.
- [ ] Run `ask` for session.
- [ ] Run `ask` for symbolic lookup.
- [ ] Run `ask` for repl-proof.

### Pass criteria

```text
All required tool calls return ok=true except intentionally negative tests.
Every result contains workspace, sessionId, requestId, backendTrace.
No standard tools/list leaks raw low-level tools.
get_all_low_level_tools lists low-level tools.
call_low_level_tool can invoke low-level tools.
```

---

# 19. Read-only graph query guard

`kg_query` must reject writes.

```ts
const FORBIDDEN_CYPHER = /\b(CREATE|MERGE|DELETE|DETACH|SET|REMOVE|DROP|LOAD\s+CSV|CALL\s+dbms|CALL\s+apoc\.create|CALL\s+apoc\.periodic|CALL\s+apoc\.load)\b/i;
```

If matched:

```json
{
  "ok": false,
  "error": {
    "code": "READ_ONLY_QUERY_VIOLATION",
    "message": "kg_query only permits read-only graph queries"
  }
}
```

---

# 20. Low-level tool naming conventions

Stable names must be namespaced.

```text
legacy.web_search
legacy.scrape
legacy.chatgpt
legacy.memory_file_save

agentmemory.recall
agentmemory.record
agentmemory.sessions

neo4j.memory_search
neo4j.memory_get_context
neo4j.memory_store

codegraph.search
codegraph.context
codegraph.impact

serena.find_symbol
serena.find_referencing_symbols
serena.get_diagnostics_for_file
serena.rename_symbol

sandbox.run_python
sandbox.run_javascript
sandbox.run_bash

model.direct_chat
model.proxy_chat
model.embed
```

If a downstream raw name changes, keep the Aidana namespaced name stable and update only the adapter mapping.

---

# 21. Security posture

This is a local personal assistant system. Do not overfit to enterprise threat models.

Still implement professional safety rails:

```text
1. Workspace path traversal prevention.
2. Optional local API key.
3. Static downstream secrets only.
4. No upstream downstream-auth exposure.
5. Read-only kg_query.
6. Sandbox timeouts.
7. Sandbox recursion depth limits.
8. Binary/large-file skip logic.
9. Optional credential redaction for logs/events.
10. No PII removal by default.
```

Credential redaction can be disabled:

```bash
AIDANA_CREDENTIAL_REDACTION=0
```

No automatic PII removal. Future explicit tool:

```text
remove_pii
```

---

# 22. Final architecture summary

```text
Aidana MCP Gateway
  announced superset tools:
    ask, kg_*, mem_*, sym_*, sem_*, proof_run, ws_*, low-level introspection

  low-level registry:
    existing browser/work-queue tools
    agentmemory raw tools
    Neo4j Agent Memory raw tools
    CodeGraph raw tools
    Serena LSP raw tools
    sandbox raw tools
    direct/proxy model calls

  state:
    workspace-local: <workspace>/.aidana/
    global config: ~/.aidana/config.json
    global downstreams: ~/.aidana/downstream.config.json
    global MCP config: ~/.aidana/mcp.json

  LLM modes:
    direct -> backend endpoint from ~/.aidana/config.json
    proxy  -> glitcr smart proxy at localhost:<llm.proxy.port>/v1 with Aidana MCP access

  proof mode:
    adapted code-sandbox MCP
    workspace mounted into container
    sandbox can call Aidana MCP
    post-run Serena diagnostics and CodeGraph symbolic diff
```

One sentence:

> Aidana is a local general-intelligence MCP gateway that gives any agent high-level memory, knowledge, symbolic lookup, semantic editing, web/research, and deterministic execution tools while still exposing all low-level tools for custom orchestration.

