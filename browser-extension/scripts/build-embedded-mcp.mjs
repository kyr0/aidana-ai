import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const browserExtensionDir = path.resolve(scriptDir, "..");
const outputDir = path.resolve(browserExtensionDir, "build", "embedded-mcp");

await mkdir(outputDir, { recursive: true });

await build({
  entryPoints: [path.resolve(browserExtensionDir, "mcp-server.ts")],
  outfile: path.resolve(outputDir, "mcp-server.cjs"),
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: false,
  sourcesContent: false,
  legalComments: "none",
  banner: {
    js: "// Embedded MCP bundle for Aidana\n",
  },
  external: [
    "node:crypto",
    "node:fs",
    "node:fs/promises",
    "node:http",
    "node:os",
    "node:path",
    "node:process",
    "node:url",
  ],
});

console.log(`Embedded MCP bundle written to ${outputDir}`);