import { homedir } from "node:os";
import { resolve } from "node:path";

export type McpTransportMode = "stdio" | "http";

export interface RuntimeConfig {
  workQueueEndpoint: string;
  workQueuePort: number;
  mcpTransport: McpTransportMode;
  mcpHost: string;
  mcpPort: number;
  mcpPath: string;
  healthPath: string;
  workspacePath: string;
}

function readStringEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function readPortEnv(name: string, fallback: number): number {
  const value = readStringEnv(name);
  if (!value) return fallback;

  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535) {
    return parsed;
  }

  return fallback;
}

function readTransportEnv(): McpTransportMode {
  const value = readStringEnv("AIDANA_MCP_TRANSPORT")?.toLowerCase();
  return value === "http" ? "http" : "stdio";
}

function resolveWorkspacePath(): string {
  const configured = readStringEnv("AIDANA_WORKSPACE_PATH");
  if (configured) {
    return resolve(configured);
  }

  return resolve(homedir());
}

function fallbackWorkQueueEndpoint(): string {
  return "http://127.0.0.1:3210";
}

function fallbackWorkQueuePort(): number {
  try {
    const url = new URL(fallbackWorkQueueEndpoint());
    return Number(url.port) || 3210;
  } catch {
    return 3210;
  }
}

const configuredWorkQueuePort = readPortEnv(
  "AIDANA_WORK_QUEUE_PORT",
  fallbackWorkQueuePort(),
);

export const runtimeConfig: RuntimeConfig = {
  workQueueEndpoint:
    readStringEnv("AIDANA_WORK_QUEUE_ENDPOINT") ||
    `http://127.0.0.1:${configuredWorkQueuePort}`,
  workQueuePort: configuredWorkQueuePort,
  mcpTransport: readTransportEnv(),
  mcpHost: readStringEnv("AIDANA_MCP_HOST") || "127.0.0.1",
  mcpPort: readPortEnv("AIDANA_MCP_PORT", 3211),
  mcpPath: readStringEnv("AIDANA_MCP_PATH") || "/mcp",
  healthPath: readStringEnv("AIDANA_MCP_HEALTH_PATH") || "/healthz",
  workspacePath: resolveWorkspacePath(),
};