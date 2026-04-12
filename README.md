# Aidana

Aidana is a macOS menu bar app that starts and supervises two local speech services:

- a streaming ASR server on `localhost:31337`
- a TTS sidecar on `localhost:31338`
- an embedded MCP sidecar on `localhost:3211`

It acts as a local speech runtime for desktop agents, prototypes, and tools that need on-device speech-to-text and text-to-speech. 

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![macOS](https://img.shields.io/badge/macOS-15.0%2B-blue.svg)](https://www.apple.com/macos/)
[![Swift](https://img.shields.io/badge/Swift-6.0-orange.svg)](https://swift.org)


## Diverse Inference

- ASR is powered by Parakeet TDT v3 via FluidAudio for efficient, streaming on-device transcription via Core ML (Apple Neural Engine, ANE)
- TTS is powered by `mlx_audio.server` as a managed Python subprocess, with support for any Hugging Face TTS model compatible with `mlx_audio` and MLX inference.

## What Aidana Does

When you launch Aidana, it lives in the menu bar and manages a local speech stack:

- **ASR** uses Parakeet TDT v3 via FluidAudio for real-time speech recognition.
- **TTS** runs `mlx_audio.server` as a managed Python subprocess for local speech synthesis.
- **MCP** runs a bundled Node-based sidecar that exposes local tools over HTTP for external MCP clients.
- **Status and lifecycle** are visible from the menu bar, Preferences, and a tabbed log window.
- **Wake word and hotwords** can gate ASR output before it reaches your client.
- **Model download, preload, and health checks** are handled automatically by the app.

## Features

- **Menu bar control plane** for local speech services
- **Streaming ASR over WebSocket** with partial, confirmed, and final transcripts
- **Local TTS over HTTP** using an OpenAI-style speech endpoint
- **Bundled MCP over HTTP** with no separate Node install required on the target Mac
- **Wake word support** to switch ASR from idle to active mode
- **Hotword boosting** for names and domain-specific terms
- **Separate ASR, TTS, and MCP logs** in a built-in log window
- **Built-in ASR diagnostics** with direct and WebSocket test actions
- **Local model caching** for both ASR and TTS

### MCP

- Port: `3211`
- Transport: Streamable HTTP
- Primary endpoint: `POST /mcp`
- Health endpoint: `GET /healthz`
- Work queue: `http://127.0.0.1:3210`

Aidana launches MCP as an embedded subprocess and keeps its status visible in the menu bar, Preferences, and the MCP log tab.

## Service Overview

### ASR

- Port: `31337`
- Model: Parakeet TDT v3
- Transport: WebSocket for audio streaming, HTTP for status endpoints
- Audio format: `Float32` PCM, `16 kHz`, mono

Endpoints:

- `GET /health`
- `GET /models`
- `WS /asr`

ASR WebSocket protocol:

- Send binary frames containing `Float32` PCM audio.
- Send `{"flush": true}` as a text frame to finalize the stream.
- Receive JSON messages shaped like:

```json
{"text":"hello world","confirmed":false,"done":false}
```

Wake word behavior:

- If no wake word is configured, ASR is always active.
- If a wake word is configured, Aidana stays in idle mode until the wake word is detected.
- Once triggered, Aidana forwards the text after the wake word.

### TTS

- Port: `31338`
- Backend: `mlx_audio.server`
- Default model: `kyr0/qwen3-TTS-12Hz-0.6B-Base-4bit-partial-quantization`
- Transport: HTTP

Common endpoints:

- `GET /v1/models`
- `POST /v1/models?model_name=...`
- `POST /v1/audio/speech`

TTS is intended to be consumed as a local service. For streaming clients, raw PCM is the safest output format.

If you stream TTS and want to save the output to a file, request `response_format: "pcm"` and wrap the bytes in a WAV header on the client side. Concatenating streamed WAV chunks directly will truncate or corrupt playback.

## Quick Start

### From Source

Prerequisites:

- macOS 15+
- Xcode 16+
- `uv` for the Python sidecar environment

Notes:

- The Xcode build downloads and pins an official Node.js LTS runtime for the embedded MCP sidecar on first build.
- Set `AIDANA_EMBEDDED_NODE_BIN` if you want to override the pinned runtime with a specific local binary.

Commands:

```bash
make setup
make build
make start
```

Useful targets:

```bash
make stop
make restart
make clean
```

Open the project in Xcode if you want to run or debug it there:

```bash
open Aidana.xcodeproj
```

Use the `Aidana` scheme.

## CI

GitHub Actions CI is configured in `.github/workflows/ci.yml` and validates the shared `Aidana` scheme on both `macos-15` and `macos-26` runners. It installs the browser-extension dependencies, prepares the pinned embedded Node runtime, builds the app with `xcodebuild`, smoke-tests the bundled MCP sidecar from the built app bundle, and packages the built `.app` as a zip inside the runner workspace under `dist/`.

The zip is created for packaging validation only right now. It is not uploaded or published by the workflow yet.

### What to Expect on First Launch

On the first run, Aidana will:

- download and load the Parakeet ASR model if it is not cached
- start the local TTS server
- preload the configured TTS model
- show progress in the menu bar and the log window

After the first successful fetch, models are reused from local cache.

## Preferences

Aidana exposes separate **ASR**, **TTS**, and **MCP** tabs in Preferences.

ASR settings include:

- server port
- auto-start on launch
- wake word
- hotwords
- ASR model cache location

TTS settings include:

- TTS server port
- model name
- reference audio path
- reference transcript
- language code
- speed
- gender
- TTS cache location

MCP settings include:

- auto-start on launch
- MCP HTTP port
- workspace root for file-based MCP tools
- manual start, stop, and restart controls
- visible MCP, health, and work-queue endpoints

## Log Window

The log window has separate tabs for **ASR**, **TTS**, and **MCP**.

ASR logs also include built-in test actions:

- **Direct Test** to run a local transcription through the loaded ASR model
- **WS Test** to send test audio through the WebSocket server path

## Test Clients

There are two small scripts in the repo for manual testing.

ASR test:

```bash
.venv/bin/python test.py
```

TTS test:

```bash
.venv/bin/python tts_test.py "Hallo, das ist ein Test der Sprachausgabe."
```

The TTS test client uses streaming PCM and writes a valid WAV file after the stream completes.

## Model Caches

ASR cache:

- managed by FluidAudio
- stored under the FluidAudio model cache directory
- visible in the ASR Preferences tab

TTS cache:

- stored under `~/.cache/huggingface/hub`
- visible in the TTS Preferences tab

Note: the TTS server may still perform Hugging Face snapshot resolution on startup even when the model is already cached locally. Inference itself remains local.

## Privacy

- ASR inference runs locally on your machine.
- TTS synthesis runs locally via the managed Python sidecar.
- No cloud speech service is required for inference after model files are available locally.

## Project Layout

- `Aidana/` — current macOS app source
- `Aidana.xcodeproj/` — Xcode project
- `test.py` — ASR WebSocket test client
- `tts_test.py` — TTS streaming PCM test client
- `Makefile` — build, start, stop, and setup helpers

## License

MIT License. See [LICENSE](LICENSE).



