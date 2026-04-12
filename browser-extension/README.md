# defuss-extension

> Browser Extension blueprint

TODO: Should use defuss-orchestrator instead of custom orchestrator (server logic).
  
### As a Developer

You're very welcome to contribute to this project.

1. Install dependencies:

```bash
bun install
```

2. Build the extension

```bash
bun run build
```

Find the output in `./dist`.

This command will compile a new version of this extension that you can load in Chrome/Chromium/Microsoft Edge/Safari/Firefox (enable developer mode and load unpackaged extension from disk).

### MCP Example Notes

`bun run test:file-search` launches `mcp-server.ts` as a child MCP server over stdio.

`bun run test:doctor-search` does the same and calls the `116117_search` MCP tool.

Do not run `bun run mcp` at the same time as `bun run test:file-search`, because both flows would try to own the same HTTP work-queue server on port `3210`.

The same restriction applies to `bun run test:doctor-search`.

### Embedded Node Runtime

Aidana's macOS app build now prefers a pinned official Node.js runtime instead of whatever `node` happens to be on the build machine.

To prepare that runtime manually:

```bash
sh ../scripts/prepare-embedded-node.sh
```

Or, from the browser-extension package itself:

```bash
bun run prepare:embedded-node
```

That script:

- downloads the pinned official Node.js LTS macOS arm64 and x64 tarballs
- verifies them against `SHASUMS256.txt`
- combines both `node` binaries into a single universal macOS executable
- caches the result under `browser-extension/build/embedded-node/`

You can override the staged runtime with `AIDANA_EMBEDDED_NODE_BIN=/absolute/path/to/node`.

### TalkingHead Assets

To stage the upstream TalkingHead example assets used by Aidana's browser extension:

```bash
bun run prepare:talkinghead-assets
```

That script downloads:

- avatar models into `browser-extension/public/avatars/`
- animation assets into `browser-extension/public/animations/`
- impulse responses into `browser-extension/public/impulse-responses/`

By default it pulls:

- the base TalkingHead avatars and impulse responses from `kyr0/TalkingHead`
- `david.glb` and `julia.glb` from `kyr0/HeadAudio`
- `bruce_avaturn.glb` and `fabio_avaturn.glb` from `kyr0/riverst`
- `thinking.fbx` plus the `F_Standing_Idle_00x.glb` idle set from `kyr0/riverst`

It keeps the impulse responses in `impulse-responses` instead of the upstream `audio` folder name so the packaged asset layout is explicit.

### Test Embedded Build

```bash
AIDANA_MCP_TRANSPORT=http AIDANA_MCP_PORT=33221 AIDANA_WORK_QUEUE_PORT=33220 AIDANA_WORKSPACE_PATH='/Users/admin/Code/Aidana/Starling-main' '/Users/admin/Library/Developer/Xcode/DerivedData/Aidana-efeahdjexitpdpcslbkfmyraodqt/Build/Products/Debug/Aidana.app/Contents/Resources/EmbeddedMCP/runtime/bin/node' '/Users/admin/Library/Developer/Xcode/DerivedData/Aidana-efeahdjexitpdpcslbkfmyraodqt/Build/Products/Debug/Aidana.app/Contents/Resources/EmbeddedMCP/mcp-server.cjs'
```
