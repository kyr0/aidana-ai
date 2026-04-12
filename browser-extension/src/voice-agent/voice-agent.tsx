import "./voice-agent.css";

import { createIncremarkParser } from "@incremark/core";
import { $, render } from "defuss";
import type { FC } from "defuss";
import { updateWithMarkdown } from "defuss-markdown";
import type { ParserLike } from "defuss-markdown";
import {
    Alert,
    AlertDescription,
    AlertTitle,
    Button,
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    Label,
    Separator,
} from "defuss-shadcn";
import { createWorkerRpcClient } from "../lib/rpc";
import type { WorkerRpcApi } from "../worker-rpc";
import { TalkingHead } from "@met4citizen/talkinghead";
// @ts-ignore Upstream package does not ship declarations for these module entrypoints.
import { LipsyncDe } from "@met4citizen/talkinghead/modules/lipsync-de.mjs";
// @ts-ignore Upstream package does not ship declarations for these module entrypoints.
import { LipsyncEn } from "@met4citizen/talkinghead/modules/lipsync-en.mjs";
// @ts-ignore Upstream package does not ship declarations for these module entrypoints.
import { LipsyncFr } from "@met4citizen/talkinghead/modules/lipsync-fr.mjs";
import { createVoiceDetector, VOICE_DETECTOR_DEFAULTS } from "defuss-vad";
import type { VoiceDetector, VoiceDetectorOptions } from "defuss-vad";

const TARGET_SAMPLE_RATE = 16000;
const HOP_SIZE = 256;
const PRE_ROLL_FRAMES = 10;
const END_OF_SPEECH_GRACE_MS = 480;
const HANGOVER_FRAMES = Math.ceil(
    ((END_OF_SPEECH_GRACE_MS / 1000) * TARGET_SAMPLE_RATE) / HOP_SIZE,
);
const VOICE_ACTIVITY_STREAM_DELAY_MS = 320;
const VOICE_ACTIVITY_STREAM_DELAY_FRAMES = Math.ceil(
    ((VOICE_ACTIVITY_STREAM_DELAY_MS / 1000) * TARGET_SAMPLE_RATE) / HOP_SIZE,
);
const SHORT_UTTERANCE_FALLBACK_MIN_MS = 96;
const SHORT_UTTERANCE_FALLBACK_MIN_FRAMES = Math.ceil(
    ((SHORT_UTTERANCE_FALLBACK_MIN_MS / 1000) * TARGET_SAMPLE_RATE) / HOP_SIZE,
);
const MAX_LOG_LINES = 120;
const MAX_OVERLAY_MESSAGES = 8;
const PCM_PACKET_DEBUG_INTERVAL = 10;
const OVERLAY_MARKDOWN_PARSER_OPTIONS = Object.freeze({
    gfm: true,
    math: true,
    htmlTree: true,
    containers: true,
});
const VOICE_DETECTOR_TUNING: VoiceDetectorOptions = Object.freeze({
    threshold: 0.64,
    rmsFloor: 0.01,
    debounceOn: 2,
    debounceOff: 6,
    hopSize: HOP_SIZE,
});

const HEALTH_URL = "http://localhost:31337/health";
const ASR_URL = "ws://localhost:31337/asr";
const ASR_CONFIG_URL = "http://localhost:31337/asr/config";
const TTS_CONFIG_URL = "http://localhost:31337/tts/config";
const DEFAULT_TTS_PORT = 31338;
const DEFAULT_TTS_SPEED = 3;
const DEFAULT_TTS_STREAMING_INTERVAL = 0.25;
const MIN_TTS_SPEED = 0.25;
const MAX_TTS_SPEED = 6;
const MIN_TTS_STREAMING_INTERVAL = 0.05;
const MAX_TTS_STREAMING_INTERVAL = 4;
const TTS_STREAM_START_BUFFER_SECONDS = 0.18;
const TTS_STREAM_START_LEAD_SECONDS = 0.06;
const TTS_STREAM_PACKET_DEBUG_INTERVAL = 10;
const THINKING_ANIMATION_URL = chrome.runtime.getURL("animations/thinking.fbx");
const THINKING_ANIMATION_DURATION_SECONDS = 2;
const THINKING_ANIMATION_DURATION_MS = THINKING_ANIMATION_DURATION_SECONDS * 1000;
const AVATAR_ANIMATION_IDLE_STATUS = "Idle loop";

const DEVICE_PREF_KEY = "__aidana_voice_agent_input_device";
const MIC_PERMISSION_PREF_KEY = "__aidana_voice_agent_mic_permission";
const AVATAR_PREF_KEY = "__aidana_voice_agent_avatar";
const ASR_LANGUAGE_PREF_KEY = "__aidana_voice_agent_asr_language";
const TTS_SPEED_PREF_KEY = "__aidana_voice_agent_tts_speed";
const TTS_STREAMING_INTERVAL_PREF_KEY = "__aidana_voice_agent_tts_streaming_interval";
const VOICE_SPACE_PREF_KEY = "__aidana_voice_agent_voice_space";

const ASR_LANGUAGES = [
    { id: "german", label: "German" },
    { id: "auto", label: "Auto" },
    { id: "english", label: "English" },
    { id: "french", label: "French" },
    { id: "spanish", label: "Spanish" },
    { id: "italian", label: "Italian" },
    { id: "dutch", label: "Dutch" },
    { id: "portuguese", label: "Portuguese" },
    { id: "polish", label: "Polish" },
    { id: "swedish", label: "Swedish" },
    { id: "danish", label: "Danish" },
    { id: "finnish", label: "Finnish" },
    { id: "czech", label: "Czech" },
    { id: "greek", label: "Greek" },
    { id: "hungarian", label: "Hungarian" },
    { id: "romanian", label: "Romanian" },
    { id: "russian", label: "Russian" },
    { id: "turkish", label: "Turkish" },
] as const;

const TALKING_HEAD_LIPSYNC_LANGS = Object.freeze({
    german: "de",
    deutsch: "de",
    de: "de",
    "de-de": "de",
    english: "en",
    en: "en",
    "en-us": "en",
    "en-gb": "en",
    french: "fr",
    fr: "fr",
    "fr-fr": "fr",
} as const);

const AVATARS = [
    {
        id: "julia",
        label: "Julia",
        url: chrome.runtime.getURL("avatars/julia.glb"),
        body: "F" as const,
    },
    {
        id: "david",
        label: "David",
        url: chrome.runtime.getURL("avatars/david.glb"),
        body: "M" as const,
    },
] as const;

const VOICE_SPACES = [
    {
        id: "none",
        label: "None",
        url: null,
        wetMix: 0,
    },
    {
        id: "basement",
        label: "Basement",
        url: chrome.runtime.getURL("impulse-responses/ir-basement.m4a"),
        wetMix: 0.34,
    },
    {
        id: "church",
        label: "Church",
        url: chrome.runtime.getURL("impulse-responses/ir-church.m4a"),
        wetMix: 0.42,
    },
    {
        id: "forest",
        label: "Forest",
        url: chrome.runtime.getURL("impulse-responses/ir-forest.m4a"),
        wetMix: 0.28,
    },
    {
        id: "room",
        label: "Room",
        url: chrome.runtime.getURL("impulse-responses/ir-room.m4a"),
        wetMix: 0.3,
    },
] as const;

type WorkerRpc = { WorkerRpc: WorkerRpcApi };
const rpc = await createWorkerRpcClient<WorkerRpc>();
const { WorkerRpc } = rpc;

type MicrophoneOption = {
    deviceId: string;
    label: string;
};

type OverlayRole = "user" | "assistant";

type OverlayMessage = {
    id: string;
    role: OverlayRole;
    content: string;
    createdAt: number;
    streaming: boolean;
};

type AsrLanguageId = (typeof ASR_LANGUAGES)[number]["id"];
type VoiceSpaceId = (typeof VOICE_SPACES)[number]["id"];

type ASRConfig = {
    language: string;
    wakeWord: string;
    hotwords: string[];
    effectiveHotwords: string[];
    hotwordBoostingEnabled: boolean;
    sampleRate: number;
};

type TTSConfig = {
    port: number;
    model: string;
    refAudioPath: string;
    refText: string;
    langCode: string;
    speed: number;
    gender: string;
    streamingInterval: number;
    sampleRate: number;
    channels: number;
    bitsPerSample: number;
};

type TTSRequestSettings = {
    speed: number;
    streamingInterval: number;
};

type TTSQueueItem = {
    id: string;
    text: string;
    createdAt: number;
    speed: number;
    streamingInterval: number;
};

type VoiceDetectionResult = {
    isVoiceStable: boolean;
    rms: number;
    onVoiceStart?: boolean;
    onVoiceEnd?: boolean;
};

type AvatarAnimationMode = "idle" | "manual" | "auto";

type AgentState = {
    head: any | null;
    avatarReady: boolean;
    currentAvatarId: string;
    loadedAvatarId: string | null;
    microphones: MicrophoneOption[];
    selectedDeviceId: string | null;
    selectedAsrLanguage: AsrLanguageId;
    asrLanguageDirty: boolean;
    selectedTtsSpeed: number;
    ttsSpeedDirty: boolean;
    selectedTtsStreamingInterval: number;
    ttsStreamingIntervalDirty: boolean;
    selectedVoiceSpace: VoiceSpaceId;
    detector: VoiceDetector | null;
    sessionActive: boolean;
    preparingSession: boolean;
    micStream: MediaStream | null;
    audioCtx: AudioContext | null;
    source: MediaStreamAudioSourceNode | null;
    processor: ScriptProcessorNode | null;
    muteNode: GainNode | null;
    residual: Float32Array;
    prerollFrames: Float32Array[];
    pendingVoiceFrames: Float32Array[];
    socket: WebSocket | null;
    socketState: "idle" | "connecting" | "streaming" | "waiting" | "error";
    websocketQueue: Array<ArrayBuffer | string>;
    stableVoiceFrames: number;
    utteranceActive: boolean;
    awaitingFinal: boolean;
    hangoverFramesRemaining: number;
    asrHealthy: boolean | null;
    confirmedTranscript: string;
    volatileTranscript: string;
    transcriptHistory: string[];
    overlayMessages: OverlayMessage[];
    streamingUserMessageId: string | null;
    logLines: string[];
    avatarAnimationMode: AvatarAnimationMode;
    avatarAnimationStatus: string;
    currentLevel: number;
    pcmPacketsSent: number;
    asrTextPacketCount: number;
    lastAsrPacketText: string;
    asrConfig: ASRConfig | null;
    ttsConfig: TTSConfig | null;
    ttsQueue: TTSQueueItem[];
    ttsRequestActive: boolean;
    ttsPlaying: boolean;
    ttsGateActive: boolean;
    ttsPendingChunks: Float32Array[];
    ttsPendingSeconds: number;
    ttsNextPlaybackTime: number;
    ttsPrimed: boolean;
    ttsChunkRemainder: Uint8Array;
    ttsAbortController: AbortController | null;
    ttsOutputNode: GainNode | null;
    ttsDryNode: GainNode | null;
    ttsWetNode: GainNode | null;
    ttsConvolverNode: ConvolverNode | null;
    ttsAnalyserNode: AnalyserNode | null;
    ttsAppliedVoiceSpace: VoiceSpaceId | null;
    ttsScheduledSources: Set<AudioBufferSourceNode>;
    overlayAutoScrollPinned: boolean;
    destroying: boolean;
};

const state: AgentState = {
    head: null,
    avatarReady: false,
    currentAvatarId: AVATARS[0].id,
    loadedAvatarId: null,
    microphones: [],
    selectedDeviceId: null,
    selectedAsrLanguage: ASR_LANGUAGES[0].id,
    asrLanguageDirty: false,
    selectedTtsSpeed: DEFAULT_TTS_SPEED,
    ttsSpeedDirty: false,
    selectedTtsStreamingInterval: DEFAULT_TTS_STREAMING_INTERVAL,
    ttsStreamingIntervalDirty: false,
    selectedVoiceSpace: VOICE_SPACES[0].id,
    detector: null,
    sessionActive: false,
    preparingSession: false,
    micStream: null,
    audioCtx: null,
    source: null,
    processor: null,
    muteNode: null,
    residual: new Float32Array(0),
    prerollFrames: [],
    pendingVoiceFrames: [],
    socket: null,
    socketState: "idle",
    websocketQueue: [],
    stableVoiceFrames: 0,
    utteranceActive: false,
    awaitingFinal: false,
    hangoverFramesRemaining: 0,
    asrHealthy: null,
    confirmedTranscript: "",
    volatileTranscript: "",
    transcriptHistory: [],
    overlayMessages: [],
    streamingUserMessageId: null,
    logLines: [],
    avatarAnimationMode: "idle",
    avatarAnimationStatus: AVATAR_ANIMATION_IDLE_STATUS,
    currentLevel: 0,
    pcmPacketsSent: 0,
    asrTextPacketCount: 0,
    lastAsrPacketText: "",
    asrConfig: null,
    ttsConfig: null,
    ttsQueue: [],
    ttsRequestActive: false,
    ttsPlaying: false,
    ttsGateActive: false,
    ttsPendingChunks: [],
    ttsPendingSeconds: 0,
    ttsNextPlaybackTime: 0,
    ttsPrimed: false,
    ttsChunkRemainder: new Uint8Array(0),
    ttsAbortController: null,
    ttsOutputNode: null,
    ttsDryNode: null,
    ttsWetNode: null,
    ttsConvolverNode: null,
    ttsAnalyserNode: null,
    ttsAppliedVoiceSpace: null,
    ttsScheduledSources: new Set<AudioBufferSourceNode>(),
    overlayAutoScrollPinned: true,
    destroying: false,
};

let mouthMesh: any = null;
let mouthTargets: Record<string, number> = {};
let targetMouthValue = 0;
let currentMouthValue = 0;
let animationLoopStarted = false;
let overlayMarkdownDisabled = false;
let asrConfigPromise: Promise<ASRConfig> | null = null;
let ttsConfigPromise: Promise<TTSConfig> | null = null;
let ttsAnalyserSamples: Uint8Array<ArrayBuffer> | null = null;
let avatarAnimationTimer: ReturnType<typeof setTimeout> | null = null;
const voiceSpaceBytesCache = new Map<VoiceSpaceId, ArrayBuffer>();
const voiceSpaceBytesPromises = new Map<VoiceSpaceId, Promise<ArrayBuffer>>();
let ttsVoiceSpaceApplyToken = 0;

function clearAvatarAnimationTimer() {
    if (avatarAnimationTimer == null) {
        return;
    }

    clearTimeout(avatarAnimationTimer);
    avatarAnimationTimer = null;
}

function setAvatarAnimationState(
    mode: AvatarAnimationMode,
    status: string,
    rerender = true,
) {
    if (
        state.avatarAnimationMode === mode &&
        state.avatarAnimationStatus === status
    ) {
        if (rerender) {
            renderSessionState();
        }
        return;
    }

    state.avatarAnimationMode = mode;
    state.avatarAnimationStatus = status;

    if (rerender) {
        renderSessionState();
    }
}

function resetAvatarAnimationState(rerender = true) {
    clearAvatarAnimationTimer();
    setAvatarAnimationState("idle", AVATAR_ANIMATION_IDLE_STATUS, rerender);
}

function currentAutoThinkingStatus() {
    if (!state.avatarReady || !state.head || state.preparingSession) {
        return null;
    }

    if (state.ttsRequestActive && !state.ttsPlaying) {
        return "Auto thinking: waiting on TTS response";
    }

    if (state.awaitingFinal) {
        return "Auto thinking: waiting on ASR final";
    }

    return null;
}

function scheduleAvatarThinkingCycle(mode: AvatarAnimationMode, status: string) {
    if (!state.head || !state.avatarReady) {
        resetAvatarAnimationState();
        return;
    }

    clearAvatarAnimationTimer();
    setAvatarAnimationState(mode, status);

    try {
        const animationResult = state.head.playAnimation(
            THINKING_ANIMATION_URL,
            null,
            THINKING_ANIMATION_DURATION_SECONDS,
        );

        if (animationResult && typeof animationResult.catch === "function") {
            void animationResult.catch((error: unknown) => {
                const message = error instanceof Error ? error.message : String(error);
                appendLog(`Thinking animation failed: ${message}`);
                resetAvatarAnimationState();
            });
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        appendLog(`Thinking animation failed: ${message}`);
        resetAvatarAnimationState();
        return;
    }

    avatarAnimationTimer = setTimeout(() => {
        avatarAnimationTimer = null;

        const nextAutoStatus = currentAutoThinkingStatus();
        if (nextAutoStatus) {
            scheduleAvatarThinkingCycle("auto", nextAutoStatus);
            return;
        }

        resetAvatarAnimationState();
    }, THINKING_ANIMATION_DURATION_MS);
}

function syncAutoThinkingAnimation() {
    const autoStatus = currentAutoThinkingStatus();

    if (!autoStatus) {
        if (state.avatarAnimationMode === "auto") {
            resetAvatarAnimationState();
        }
        return;
    }

    if (state.avatarAnimationMode === "manual") {
        return;
    }

    if (
        state.avatarAnimationMode === "auto" &&
        state.avatarAnimationStatus === autoStatus &&
        avatarAnimationTimer != null
    ) {
        return;
    }

    if (state.avatarAnimationMode !== "auto" || state.avatarAnimationStatus !== autoStatus) {
        appendLog(autoStatus);
        traceVoiceAgent("avatar animation auto", {
            status: autoStatus,
            avatarId: state.currentAvatarId,
        });
    }

    scheduleAvatarThinkingCycle("auto", autoStatus);
}

function q<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Missing DOM node #${id}`);
    }
    return element as T;
}

function currentAvatar() {
    return AVATARS.find((item) => item.id === state.currentAvatarId) ?? AVATARS[0];
}

function currentVoiceSpace() {
    return VOICE_SPACES.find((item) => item.id === state.selectedVoiceSpace) ?? VOICE_SPACES[0];
}

function activeMicrophoneLabel(): string | null {
    const label = state.micStream?.getAudioTracks()[0]?.label?.trim();
    return label ? label : null;
}

function selectedMicrophoneLabel(): string {
    const activeLabel = activeMicrophoneLabel();
    if (activeLabel) {
        return activeLabel;
    }

    if (!state.selectedDeviceId) {
        return "Browser-selected microphone will appear after access is granted";
    }

    const match = state.microphones.find(
        (device) => device.deviceId === state.selectedDeviceId,
    );

    if (match) {
        return match.label;
    }

    return "Stored microphone will be restored if the browser exposes it again";
}

function syncAvatarSelect() {
    const select = document.getElementById("avatar-select") as HTMLSelectElement | null;
    if (!select) {
        return;
    }

    select.value = state.currentAvatarId;
    select.disabled = state.preparingSession;
}

function syncAsrLanguageSelect() {
    const select = document.getElementById("asr-language-select") as HTMLSelectElement | null;
    if (!select) {
        return;
    }

    select.value = state.selectedAsrLanguage;
    select.disabled = state.preparingSession;
}

function formatTtsControlValue(value: number) {
    return String(Math.round(value * 100) / 100);
}

function normalizeTtsControlValue(value: number, fallback: number, min: number, max: number) {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    const rounded = Math.round(value * 100) / 100;
    return Math.min(max, Math.max(min, rounded));
}

function normalizeTtsSpeed(value: number) {
    return normalizeTtsControlValue(value, DEFAULT_TTS_SPEED, MIN_TTS_SPEED, MAX_TTS_SPEED);
}

function normalizeTtsStreamingInterval(value: number) {
    return normalizeTtsControlValue(
        value,
        DEFAULT_TTS_STREAMING_INTERVAL,
        MIN_TTS_STREAMING_INTERVAL,
        MAX_TTS_STREAMING_INTERVAL,
    );
}

function currentTtsRequestSettings(): TTSRequestSettings {
    return {
        speed: normalizeTtsSpeed(state.selectedTtsSpeed),
        streamingInterval: normalizeTtsStreamingInterval(state.selectedTtsStreamingInterval),
    };
}

function syncTtsControlInputs() {
    const speedInput = document.getElementById("tts-speed-input") as HTMLInputElement | null;
    if (speedInput) {
        speedInput.value = formatTtsControlValue(state.selectedTtsSpeed);
        speedInput.disabled = state.preparingSession;
    }

    const streamingIntervalInput = document.getElementById(
        "tts-streaming-interval-input",
    ) as HTMLInputElement | null;
    if (streamingIntervalInput) {
        streamingIntervalInput.value = formatTtsControlValue(state.selectedTtsStreamingInterval);
        streamingIntervalInput.disabled = state.preparingSession;
    }
}

function syncVoiceSpaceSelect() {
    const select = document.getElementById("voice-space-select") as HTMLSelectElement | null;
    if (!select) {
        return;
    }

    select.value = state.selectedVoiceSpace;
    select.disabled = state.preparingSession;
}

function setStatus(
    title: string,
    description: string,
    tone: "default" | "destructive" = "default",
) {
    $(q("voice-status")).update(
        <Alert variant={tone === "destructive" ? "destructive" : undefined}>
            <AlertTitle>{title}</AlertTitle>
            <AlertDescription>{description}</AlertDescription>
        </Alert>,
    );
}

function appendLog(line: string) {
    const timestamp = new Date().toLocaleTimeString();
    const nextLine = `${timestamp}  ${line}`;
    state.logLines = [nextLine, ...state.logLines].slice(0, MAX_LOG_LINES);
    q<HTMLPreElement>("voice-log").textContent = state.logLines.join("\n");
}

function traceVoiceAgent(event: string, payload?: unknown) {
    const timestamp = new Date().toISOString();

    if (payload === undefined) {
        console.log(`[voice-agent] ${timestamp} ${event}`);
        return;
    }

    console.log(`[voice-agent] ${timestamp} ${event}`, payload);
}

function resetAsrDebugCounters() {
    state.pcmPacketsSent = 0;
    state.asrTextPacketCount = 0;
    state.lastAsrPacketText = "";
}

function logAsrTokenDelta(nextText: string) {
    const trimmedText = nextText.trim();
    if (!trimmedText) {
        return;
    }

    const previousText = state.lastAsrPacketText.trim();
    if (previousText && trimmedText.startsWith(previousText)) {
        const appendedText = trimmedText.slice(previousText.length).trim();
        if (!appendedText) {
            state.lastAsrPacketText = trimmedText;
            return;
        }

        for (const token of appendedText.split(/\s+/)) {
            traceVoiceAgent("asr<- token", token);
        }
        state.lastAsrPacketText = trimmedText;
        return;
    }

    if (previousText && previousText !== trimmedText) {
        traceVoiceAgent("asr<- replace", {
            previous: previousText,
            next: trimmedText,
        });
    }

    for (const token of trimmedText.split(/\s+/)) {
        traceVoiceAgent("asr<- token", token);
    }

    state.lastAsrPacketText = trimmedText;
}

function createOverlayMessageId() {
    return crypto.randomUUID();
}

function trimOverlayMessages() {
    if (state.overlayMessages.length <= MAX_OVERLAY_MESSAGES) {
        return;
    }

    const nextMessages = state.overlayMessages.slice(-MAX_OVERLAY_MESSAGES);
    if (
        state.streamingUserMessageId &&
        !nextMessages.some((message) => message.id === state.streamingUserMessageId)
    ) {
        state.streamingUserMessageId = null;
    }
    state.overlayMessages = nextMessages;
}

function currentStreamingUtteranceText() {
    const confirmed = state.confirmedTranscript.trim();
    const volatile = state.volatileTranscript.trim();

    if (confirmed && volatile) {
        if (volatile.startsWith(confirmed)) {
            return volatile;
        }
        return `${confirmed} ${volatile}`.trim();
    }

    return confirmed || volatile;
}

function isOverlayNearBottom(scrollHost: HTMLDivElement) {
    const remaining = scrollHost.scrollHeight - scrollHost.clientHeight - scrollHost.scrollTop;
    return remaining <= 24;
}

function scrollOverlayToLatest(force = false) {
    const scrollHost = document.getElementById("voice-overlay-scroll") as HTMLDivElement | null;
    if (!scrollHost) {
        return;
    }

    if (!force && !state.overlayAutoScrollPinned) {
        return;
    }

    scrollHost.scrollTop = scrollHost.scrollHeight;
}

async function renderOverlayMarkdown(messages: OverlayMessage[]) {
    for (const message of messages) {
        const contentEl = document.querySelector(
            `[data-overlay-msg-id="${message.id}"]`,
        );
        if (!(contentEl instanceof Element)) {
            continue;
        }

        if (overlayMarkdownDisabled) {
            contentEl.textContent = message.content;
            continue;
        }

        try {
            await updateWithMarkdown(contentEl, message.content, {
                render,
                createParser: () => createIncremarkParser(
                    OVERLAY_MARKDOWN_PARSER_OPTIONS,
                ) as unknown as ParserLike,
            });
        } catch (error) {
            overlayMarkdownDisabled = true;
            contentEl.textContent = message.content;
            const reason = error instanceof Error ? error.message : String(error);
            appendLog(`Overlay markdown disabled, falling back to plain text: ${reason}`);
        }
    }

    scrollOverlayToLatest();
}

function renderOverlayMessages() {
    const host = document.getElementById("voice-overlay-stream");
    if (!host) {
        return;
    }

    if (state.overlayMessages.length === 0) {
        $(host).update(<div class="voice-overlay-empty" />);
        return;
    }

    const messages = [...state.overlayMessages];
    $(host).update(
        <div class="voice-overlay-stack">
            {messages.map((message) => (
                <div
                    key={message.id}
                    class={`voice-overlay-row ${message.role === "user" ? "is-user" : "is-assistant"}`}
                >
                    <div
                        class={`voice-overlay-bubble ${message.role === "user" ? "is-user" : "is-assistant"} ${message.streaming ? "is-streaming" : ""}`}
                    >
                        <div class="voice-overlay-sender">
                            {message.role === "user" ? "YOU" : "AIDANA"}
                        </div>
                        <div
                            class="voice-overlay-markdown"
                            data-overlay-msg-id={message.id}
                        >
                            {message.content}
                        </div>
                        <div class="voice-overlay-footer">
                            {message.streaming ? <span class="voice-overlay-live">Live</span> : null}
                            <span>
                                {new Date(message.createdAt).toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                })}
                            </span>
                        </div>
                    </div>
                </div>
            ))}
        </div>,
    );

    requestAnimationFrame(() => {
        void renderOverlayMarkdown(messages);
    });
}

function syncStreamingUserOverlay(nextText = currentStreamingUtteranceText()) {
    const displayText = nextText.trim();
    if (!displayText) {
        return;
    }

    if (!state.streamingUserMessageId) {
        const message: OverlayMessage = {
            id: createOverlayMessageId(),
            role: "user",
            content: displayText,
            createdAt: Date.now(),
            streaming: true,
        };

        state.streamingUserMessageId = message.id;
        state.overlayMessages = [...state.overlayMessages, message];
        trimOverlayMessages();
        renderOverlayMessages();
        return;
    }

    const message = state.overlayMessages.find(
        (item) => item.id === state.streamingUserMessageId,
    );
    if (!message) {
        return;
    }

    message.content = displayText;
    message.streaming = true;
    renderOverlayMessages();
}

function finalizeStreamingUserOverlay(finalText: string) {
    const trimmedText = finalText.trim();
    const message = state.overlayMessages.find(
        (item) => item.id === state.streamingUserMessageId,
    );

    if (!trimmedText) {
        if (message) {
            const existingText = message.content.trim();
            if (existingText) {
                message.content = existingText;
                message.streaming = false;
            } else {
                state.overlayMessages = state.overlayMessages.filter(
                    (item) => item.id !== message.id,
                );
            }
        }
        state.streamingUserMessageId = null;
        renderOverlayMessages();
        return;
    }

    if (message) {
        message.content = trimmedText;
        message.streaming = false;
    } else {
        state.overlayMessages = [
            ...state.overlayMessages,
            {
                id: createOverlayMessageId(),
                role: "user",
                content: trimmedText,
                createdAt: Date.now(),
                streaming: false,
            },
        ];
        trimOverlayMessages();
    }

    state.streamingUserMessageId = null;
    renderOverlayMessages();
}

function clearStreamingUserOverlay() {
    if (!state.streamingUserMessageId) {
        return;
    }

    state.overlayMessages = state.overlayMessages.filter(
        (item) => item.id !== state.streamingUserMessageId,
    );
    state.streamingUserMessageId = null;
    renderOverlayMessages();
}

function appendOverlayMessage(
    role: OverlayRole,
    content: string,
    streaming = false,
): string | null {
    const trimmedContent = content.trim();
    if (!trimmedContent) {
        return null;
    }

    const message: OverlayMessage = {
        id: createOverlayMessageId(),
        role,
        content: trimmedContent,
        createdAt: Date.now(),
        streaming,
    };

    state.overlayMessages = [...state.overlayMessages, message];
    trimOverlayMessages();
    renderOverlayMessages();
    return message.id;
}

function setOverlayMessageStreaming(messageId: string | null, streaming: boolean) {
    if (!messageId) {
        return;
    }

    const message = state.overlayMessages.find((item) => item.id === messageId);
    if (!message) {
        return;
    }

    message.streaming = streaming;
    renderOverlayMessages();
}

function finalizeAssistantOverlayStreaming() {
    let didUpdate = false;
    for (const message of state.overlayMessages) {
        if (message.role !== "assistant" || !message.streaming) {
            continue;
        }
        message.streaming = false;
        didUpdate = true;
    }

    if (didUpdate) {
        renderOverlayMessages();
    }
}

function listeningStatusDescription() {
    const microphoneName = activeMicrophoneLabel() ?? "the selected microphone";
    return `Aidana is capturing ${microphoneName} with echo cancellation, will stream only VAD-detected utterances to the local ASR service, and will pause capture while local TTS playback is draining.`;
}

function setListeningStatus() {
    setStatus("Listening", listeningStatusDescription());
}

function normalizeTtsInput(text: string) {
    return text.replace(/\s+/g, " ").trim();
}

function currentTalkingHeadLipsyncLang(config: TTSConfig | null = state.ttsConfig) {
    const candidates = [
        config?.langCode,
        state.selectedAsrLanguage,
        navigator.language,
    ];

    for (const candidate of candidates) {
        const value = String(candidate ?? "").trim().toLowerCase().replace(/_/g, "-");
        if (!value) {
            continue;
        }

        if (value in TALKING_HEAD_LIPSYNC_LANGS) {
            return TALKING_HEAD_LIPSYNC_LANGS[value as keyof typeof TALKING_HEAD_LIPSYNC_LANGS];
        }

        if (value.startsWith("de")) {
            return "de";
        }
        if (value.startsWith("en")) {
            return "en";
        }
        if (value.startsWith("fr")) {
            return "fr";
        }
    }

    return "de";
}

function ensureTalkingHeadLipsyncModules(head: any) {
    if (!head?.lipsync) {
        return;
    }

    if (!head.lipsync.de) {
        head.lipsync.de = new LipsyncDe();
    }
    if (!head.lipsync.en) {
        head.lipsync.en = new LipsyncEn();
    }
    if (!head.lipsync.fr) {
        head.lipsync.fr = new LipsyncFr();
    }
}

function buildApproximateTtsWordTimeline(text: string, config: TTSConfig) {
    const words = text.match(/\S+/g) ?? [];
    if (words.length === 0) {
        return null;
    }

    const speedFactor = Math.max(0.72, Math.min(1.32, 1 + (3 - config.speed) * 0.18));
    let cursorMs = 0;
    const wtimes: number[] = [];
    const wdurations: number[] = [];

    for (const word of words) {
        const stripped = word.replace(/[^\p{L}\p{N}]/gu, "");
        const symbolCount = Math.max(1, stripped.length || word.length);
        const trailingPause = /[.!?]$/.test(word)
            ? 220
            : /[,;:]$/.test(word)
                ? 120
                : 45;
        const durationMs = Math.max(
            110,
            Math.round((symbolCount * 58 + trailingPause) * speedFactor),
        );

        wtimes.push(cursorMs);
        wdurations.push(durationMs);
        cursorMs += durationMs;
    }

    return {
        words,
        wtimes,
        wdurations,
        estimatedDurationMs: cursorMs,
    };
}

function currentTtsUrl() {
    const port = state.ttsConfig?.port ?? DEFAULT_TTS_PORT;
    return `http://localhost:${port}/v1/audio/speech`;
}

function ttsSampleRate() {
    return state.ttsConfig?.sampleRate ?? 24000;
}

function hasPendingTtsWork() {
    return state.ttsRequestActive ||
    state.ttsPlaying ||
        state.ttsQueue.length > 0;
}

function resetTtsPendingBuffers() {
    state.ttsPendingChunks = [];
    state.ttsPendingSeconds = 0;
    state.ttsNextPlaybackTime = 0;
    state.ttsPrimed = false;
    state.ttsChunkRemainder = new Uint8Array(0);
}

function stopScheduledTtsSources() {
    if (state.ttsScheduledSources.size === 0) {
        return;
    }

    for (const source of state.ttsScheduledSources) {
        try {
            source.onended = null;
            source.stop();
        } catch { }

        try {
            source.disconnect();
        } catch { }
    }

    state.ttsScheduledSources.clear();
}

function activateTtsGate() {
    if (state.ttsGateActive) {
        return;
    }

    state.ttsGateActive = true;
    state.currentLevel = 0;
    state.residual = new Float32Array(0);
    state.prerollFrames = [];
    targetMouthValue = 0;
    currentMouthValue = 0;
    resetVoiceActivityGate();
    updateLevelIndicator();
    applyMouthMorph(0);
    renderSessionState();
    setStatus(
        "Speaking",
        "Aidana is streaming local TTS audio. Microphone capture is paused until playback drains to avoid feeding the speaker output back into ASR.",
    );
    appendLog("Pausing ASR capture while streamed TTS audio is playing.");
}

function releaseTtsGateIfIdle() {
    if (!state.ttsGateActive || hasPendingTtsWork()) {
        return;
    }

    state.ttsGateActive = false;
    state.ttsPlaying = false;
    state.currentLevel = 0;
    targetMouthValue = 0;
    currentMouthValue = 0;
    updateLevelIndicator();
    applyMouthMorph(0);
    renderSessionState();

    if (state.sessionActive && !state.destroying) {
        setListeningStatus();
        appendLog("TTS playback drained. ASR capture resumed.");
    }

    if (state.sessionActive && state.ttsQueue.length > 0) {
        void pumpTtsQueue();
    }
}

function stopTtsPlayback(reason: string) {
    const hadActivity = state.ttsGateActive || hasPendingTtsWork();
    const controller = state.ttsAbortController;

    state.ttsQueue = [];
    state.ttsRequestActive = false;
    state.ttsAbortController = null;
    state.ttsPlaying = false;

    if (controller) {
        controller.abort();
    }

    try {
        state.head?.streamStop?.();
    } catch { }

    try {
        state.head?.stopSpeaking?.();
    } catch { }

    stopScheduledTtsSources();
    resetTtsPendingBuffers();

    if (state.ttsOutputNode) {
        try {
            state.ttsOutputNode.disconnect();
        } catch { }
        state.ttsOutputNode = null;
    }

    if (state.ttsDryNode) {
        try {
            state.ttsDryNode.disconnect();
        } catch { }
        state.ttsDryNode = null;
    }

    if (state.ttsWetNode) {
        try {
            state.ttsWetNode.disconnect();
        } catch { }
        state.ttsWetNode = null;
    }

    if (state.ttsConvolverNode) {
        try {
            state.ttsConvolverNode.disconnect();
        } catch { }
        state.ttsConvolverNode = null;
    }

    if (state.ttsAnalyserNode) {
        try {
            state.ttsAnalyserNode.disconnect();
        } catch { }
        state.ttsAnalyserNode = null;
        ttsAnalyserSamples = null;
    }

    state.ttsAppliedVoiceSpace = null;

    finalizeAssistantOverlayStreaming();

    if (hadActivity) {
        state.ttsGateActive = false;
        state.currentLevel = 0;
        targetMouthValue = 0;
        currentMouthValue = 0;
        updateLevelIndicator();
        applyMouthMorph(0);
        appendLog(reason);
    }

    renderSessionState();
    syncAutoThinkingAnimation();
}

async function loadTtsConfig(force = false): Promise<TTSConfig> {
    if (!force && state.ttsConfig) {
        return state.ttsConfig;
    }

    if (!force && ttsConfigPromise) {
        return ttsConfigPromise;
    }

    const hadConfig = state.ttsConfig != null;
    ttsConfigPromise = (async () => {
        const response = await fetch(TTS_CONFIG_URL, { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`Aidana TTS config request failed with status ${response.status}.`);
        }

        const data = (await response.json()) as Partial<TTSConfig>;
        const config: TTSConfig = {
            port: typeof data.port === "number" && data.port > 0 ? data.port : DEFAULT_TTS_PORT,
            model: typeof data.model === "string" && data.model.length > 0
                ? data.model
                : "kyr0/qwen3-TTS-12Hz-0.6B-Base-4bit-partial-quantization",
            refAudioPath: typeof data.refAudioPath === "string" ? data.refAudioPath : "",
            refText: typeof data.refText === "string" && data.refText.length > 0
                ? data.refText
                : "Das ist ein Referenztext.",
            langCode: typeof data.langCode === "string" && data.langCode.length > 0
                ? data.langCode
                : "german",
            speed: normalizeTtsSpeed(typeof data.speed === "number" ? data.speed : DEFAULT_TTS_SPEED),
            gender: typeof data.gender === "string" && data.gender.length > 0
                ? data.gender
                : "male",
            streamingInterval: normalizeTtsStreamingInterval(
                typeof data.streamingInterval === "number"
                    ? data.streamingInterval
                    : DEFAULT_TTS_STREAMING_INTERVAL,
            ),
            sampleRate: typeof data.sampleRate === "number" && data.sampleRate > 0
                ? data.sampleRate
                : 24000,
            channels: typeof data.channels === "number" && data.channels > 0 ? data.channels : 1,
            bitsPerSample: typeof data.bitsPerSample === "number" && data.bitsPerSample > 0
                ? data.bitsPerSample
                : 16,
        };

        if (!config.refAudioPath) {
            throw new Error(
                "Aidana TTS reference audio is not configured. Set one in the Aidana TTS preferences or keep reference.wav in the project root.",
            );
        }

        state.ttsConfig = config;
        if (!state.ttsSpeedDirty) {
            state.selectedTtsSpeed = config.speed;
        }
        if (!state.ttsStreamingIntervalDirty) {
            state.selectedTtsStreamingInterval = config.streamingInterval;
        }
        traceVoiceAgent("tts config loaded", {
            port: config.port,
            model: config.model,
            langCode: config.langCode,
            speed: config.speed,
            streamingInterval: config.streamingInterval,
            sampleRate: config.sampleRate,
        });
        if (!hadConfig) {
            appendLog(`TTS config ready on port ${config.port} (${config.model}).`);
        }
        renderSessionState();
        return config;
    })().finally(() => {
        ttsConfigPromise = null;
    });

    return ttsConfigPromise;
}

async function loadAsrConfig(force = false): Promise<ASRConfig> {
    if (!force && state.asrConfig) {
        return state.asrConfig;
    }

    if (!force && asrConfigPromise) {
        return asrConfigPromise;
    }

    const hadConfig = state.asrConfig != null;
    asrConfigPromise = (async () => {
        const response = await fetch(ASR_CONFIG_URL, { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`Aidana ASR config request failed with status ${response.status}.`);
        }

        const data = (await response.json()) as Partial<ASRConfig>;
        const hotwords = Array.isArray(data.hotwords)
            ? data.hotwords.filter((item): item is string => typeof item === "string")
            : [];
        const effectiveHotwords = Array.isArray(data.effectiveHotwords)
            ? data.effectiveHotwords.filter((item): item is string => typeof item === "string")
            : hotwords;
        const language = typeof data.language === "string" && data.language.length > 0
            ? data.language
            : "auto";

        const config: ASRConfig = {
            language,
            wakeWord: typeof data.wakeWord === "string" ? data.wakeWord : "",
            hotwords,
            effectiveHotwords,
            hotwordBoostingEnabled:
                typeof data.hotwordBoostingEnabled === "boolean"
                    ? data.hotwordBoostingEnabled
                    : effectiveHotwords.length > 0,
            sampleRate: typeof data.sampleRate === "number" && data.sampleRate > 0
                ? data.sampleRate
                : TARGET_SAMPLE_RATE,
        };

        state.asrConfig = config;
        if (
            !state.asrLanguageDirty &&
            ASR_LANGUAGES.some((item) => item.id === config.language)
        ) {
            state.selectedAsrLanguage = config.language as AsrLanguageId;
        }

        traceVoiceAgent("asr config loaded", {
            language: config.language,
            sampleRate: config.sampleRate,
            hotwordBoostingEnabled: config.hotwordBoostingEnabled,
            effectiveHotwords: config.effectiveHotwords.length,
        });
        if (!hadConfig) {
            appendLog(`ASR config ready (${config.language}, ${config.sampleRate} Hz).`);
        }
        renderSessionState();
        return config;
    })().finally(() => {
        asrConfigPromise = null;
    });

    return asrConfigPromise;
}

async function initializeVoiceAgentConfig() {
    const [asrResult, ttsResult] = await Promise.allSettled([
        loadAsrConfig(),
        loadTtsConfig(),
    ]);

    if (asrResult.status === "rejected") {
        const message = asrResult.reason instanceof Error
            ? asrResult.reason.message
            : String(asrResult.reason);
        appendLog(`ASR config unavailable: ${message}`);
    }

    if (ttsResult.status === "rejected") {
        const message = ttsResult.reason instanceof Error
            ? ttsResult.reason.message
            : String(ttsResult.reason);
        appendLog(`TTS config unavailable: ${message}`);
    }

    renderSessionState();
    return {
        asrLoaded: asrResult.status === "fulfilled",
        ttsLoaded: ttsResult.status === "fulfilled",
    };
}

function appendUint8Arrays(left: Uint8Array, right: Uint8Array) {
    const merged = new Uint8Array(left.length + right.length);
    merged.set(left);
    merged.set(right, left.length);
    return merged;
}

async function loadVoiceSpaceBytes(spaceId: VoiceSpaceId) {
    const cached = voiceSpaceBytesCache.get(spaceId);
    if (cached) {
        traceVoiceAgent("voice-space asset cache hit", {
            id: spaceId,
            bytes: cached.byteLength,
        });
        return cached;
    }

    const inflight = voiceSpaceBytesPromises.get(spaceId);
    if (inflight) {
        traceVoiceAgent("voice-space asset awaiting existing request", {
            id: spaceId,
        });
        return inflight;
    }

    const space = VOICE_SPACES.find((item) => item.id === spaceId);
    if (!space?.url) {
        throw new Error(`Voice space ${spaceId} does not have an impulse response asset.`);
    }

    traceVoiceAgent("voice-space asset fetch start", {
        id: space.id,
        label: space.label,
        url: space.url,
    });

    const request = fetch(space.url)
        .then(async (response) => {
            if (!response.ok) {
                throw new Error(`Impulse response download failed (${response.status}).`);
            }

            const bytes = await response.arrayBuffer();
            voiceSpaceBytesCache.set(spaceId, bytes);
            traceVoiceAgent("voice-space asset fetch complete", {
                id: space.id,
                label: space.label,
                bytes: bytes.byteLength,
            });
            return bytes;
        })
        .finally(() => {
            voiceSpaceBytesPromises.delete(spaceId);
        });

    voiceSpaceBytesPromises.set(spaceId, request);
    return request;
}

async function applyCurrentVoiceSpace() {
    const head = state.head;
    if (!head || typeof head.setReverb !== "function") {
        traceVoiceAgent("voice-space apply deferred", {
            hasHead: !!head,
            avatarReady: state.avatarReady,
            selectedVoiceSpace: state.selectedVoiceSpace,
        });
        return;
    }

    const space = currentVoiceSpace();
    const applyToken = ++ttsVoiceSpaceApplyToken;
    state.ttsAppliedVoiceSpace = space.url ? null : space.id;

    traceVoiceAgent("voice-space apply begin", {
        id: space.id,
        label: space.label,
        url: space.url,
        sessionActive: state.sessionActive,
        avatarReady: state.avatarReady,
    });
    console.log("[voice-agent] applying voice space", {
        id: space.id,
        label: space.label,
        url: space.url,
        sessionActive: state.sessionActive,
        avatarReady: state.avatarReady,
    });

    if (!space.url) {
        await head.setReverb(null);
        state.ttsAppliedVoiceSpace = space.id;
        traceVoiceAgent("voice-space applied", {
            id: space.id,
            label: space.label,
            mode: "dry",
        });
        console.log("[voice-agent] voice space applied", {
            id: space.id,
            label: space.label,
            mode: "dry",
        });
        appendLog("Voice space None applied as a dry TalkingHead reverb impulse.");
        return;
    }

    try {
        const encoded = await loadVoiceSpaceBytes(space.id);
        if (
            applyToken !== ttsVoiceSpaceApplyToken ||
            state.head !== head ||
            state.selectedVoiceSpace !== space.id
        ) {
            return;
        }

        traceVoiceAgent("voice-space asset ready", {
            id: space.id,
            label: space.label,
            bytes: encoded.byteLength,
            cached: voiceSpaceBytesCache.has(space.id),
        });
        console.log("[voice-agent] voice space asset ready", {
            id: space.id,
            label: space.label,
            bytes: encoded.byteLength,
            cached: voiceSpaceBytesCache.has(space.id),
        });

        await head.setReverb(space.url);
        if (
            applyToken !== ttsVoiceSpaceApplyToken ||
            state.head !== head ||
            state.selectedVoiceSpace !== space.id
        ) {
            return;
        }

        state.ttsAppliedVoiceSpace = space.id;
        traceVoiceAgent("voice-space applied", {
            id: space.id,
            label: space.label,
            url: space.url,
        });
        console.log("[voice-agent] voice space applied", {
            id: space.id,
            label: space.label,
            url: space.url,
        });
        appendLog(`Voice space ${space.label} applied to TalkingHead audio output.`);
    } catch (error) {
        if (
            applyToken !== ttsVoiceSpaceApplyToken ||
            state.head !== head ||
            state.selectedVoiceSpace !== space.id
        ) {
            return;
        }

        const message = error instanceof Error ? error.message : String(error);
        state.ttsAppliedVoiceSpace = VOICE_SPACES[0].id;
        traceVoiceAgent("voice-space apply failed", {
            id: space.id,
            label: space.label,
            message,
        });
        console.log("[voice-agent] voice space apply failed", {
            id: space.id,
            label: space.label,
            message,
        });
        appendLog(`Voice space ${space.label} failed to load: ${message}`);
    }
}

function decodeTtsPcm16Le(bytes: Uint8Array) {
    const sampleCount = Math.floor(bytes.length / 2);
    const samples = new Float32Array(sampleCount);
    const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);

    for (let index = 0; index < sampleCount; index += 1) {
        samples[index] = view.getInt16(index * 2, true) / 32768;
    }

    return samples;
}

function ensureTtsOutputNode() {
    const audioCtx = state.audioCtx;
    if (!audioCtx) {
        throw new Error("Voice audio context is not ready for TTS playback.");
    }

    if (!state.ttsOutputNode) {
        const outputNode = audioCtx.createGain();
        const dryNode = audioCtx.createGain();
        const wetNode = audioCtx.createGain();
        const convolverNode = audioCtx.createConvolver();
        const analyserNode = audioCtx.createAnalyser();
        outputNode.gain.value = 1;
        dryNode.gain.value = 1;
        wetNode.gain.value = 0;
        analyserNode.fftSize = 1024;
        analyserNode.smoothingTimeConstant = 0.2;

        outputNode.connect(dryNode);
        outputNode.connect(convolverNode);
        convolverNode.connect(wetNode);
        dryNode.connect(analyserNode);
        wetNode.connect(analyserNode);
        analyserNode.connect(audioCtx.destination);

        state.ttsOutputNode = outputNode;
        state.ttsDryNode = dryNode;
        state.ttsWetNode = wetNode;
        state.ttsConvolverNode = convolverNode;
        state.ttsAnalyserNode = analyserNode;
        state.ttsAppliedVoiceSpace = null;
        ttsAnalyserSamples = null;
    }

    return state.ttsOutputNode;
}

function currentTtsPlaybackLevel() {
    const analyserNode = state.ttsAnalyserNode;
    if (!analyserNode) {
        return 0;
    }

    if (!ttsAnalyserSamples || ttsAnalyserSamples.length !== analyserNode.fftSize) {
        ttsAnalyserSamples = new Uint8Array(new ArrayBuffer(analyserNode.fftSize));
    }

    analyserNode.getByteTimeDomainData(ttsAnalyserSamples);

    let peak = 0;
    let sumSquares = 0;
    for (let index = 0; index < ttsAnalyserSamples.length; index += 1) {
        const sample = ((ttsAnalyserSamples[index] ?? 128) - 128) / 128;
        const magnitude = Math.abs(sample);
        if (magnitude > peak) {
            peak = magnitude;
        }
        sumSquares += sample * sample;
    }

    const rms = Math.sqrt(sumSquares / ttsAnalyserSamples.length);
    const level = Math.min(1, Math.max(rms * 5.4, peak * 1.35));
    return level < 0.035 ? 0 : level;
}

function scheduleTtsChunk(samples: Float32Array, sampleRate: number) {
    const audioCtx = state.audioCtx;
    if (!audioCtx || samples.length === 0) {
        return;
    }

    const outputNode = ensureTtsOutputNode();
    const buffer = audioCtx.createBuffer(1, samples.length, sampleRate);
    buffer.getChannelData(0).set(samples);

    let startAt = state.ttsNextPlaybackTime;
    const minimumStart = audioCtx.currentTime + TTS_STREAM_START_LEAD_SECONDS;
    if (startAt < minimumStart) {
        if (state.ttsPrimed && state.ttsScheduledSources.size > 0) {
            traceVoiceAgent("tts playback resync", {
                bufferedAheadMs: Math.round((state.ttsNextPlaybackTime - audioCtx.currentTime) * 1000),
            });
            appendLog("TTS playback buffer underrun detected. Re-priming the local stream.");
        }
        startAt = minimumStart;
    }

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(outputNode);
    state.ttsScheduledSources.add(source);

    source.onended = () => {
        try {
            source.disconnect();
        } catch { }

        state.ttsScheduledSources.delete(source);
        if (state.ttsScheduledSources.size === 0 && !hasPendingTtsWork()) {
            resetTtsPendingBuffers();
            releaseTtsGateIfIdle();
        }
    };

    source.start(startAt);
    state.ttsPlaying = true;
    state.ttsNextPlaybackTime = startAt + buffer.duration;
}

function flushTtsPlaybackQueue(force = false) {
    const audioCtx = state.audioCtx;
    if (!audioCtx || state.ttsPendingChunks.length === 0) {
        return;
    }

    if (
        !state.ttsPrimed &&
        !force &&
        state.ttsPendingSeconds < TTS_STREAM_START_BUFFER_SECONDS &&
        state.ttsScheduledSources.size === 0
    ) {
        return;
    }

    if (!state.ttsPrimed) {
        state.ttsPrimed = true;
        if (state.ttsNextPlaybackTime < audioCtx.currentTime + TTS_STREAM_START_LEAD_SECONDS) {
            state.ttsNextPlaybackTime = audioCtx.currentTime + TTS_STREAM_START_LEAD_SECONDS;
        }
        appendLog(`Starting TTS playback with ${Math.round(state.ttsPendingSeconds * 1000)}ms of buffered PCM.`);
        traceVoiceAgent("tts playback start", {
            bufferedMs: Math.round(state.ttsPendingSeconds * 1000),
            queueDepth: state.ttsQueue.length,
        });
        renderSessionState();
    }

    const sampleRate = ttsSampleRate();
    while (state.ttsPendingChunks.length > 0) {
        const chunk = state.ttsPendingChunks.shift();
        if (!chunk) {
            continue;
        }
        state.ttsPendingSeconds = Math.max(
            0,
            state.ttsPendingSeconds - chunk.length / sampleRate,
        );
        scheduleTtsChunk(chunk, sampleRate);
    }
}

function enqueueTtsSamples(samples: Float32Array) {
    if (samples.length === 0) {
        return;
    }

    state.ttsPendingChunks.push(samples);
    state.ttsPendingSeconds += samples.length / ttsSampleRate();
    flushTtsPlaybackQueue(false);
}

function ingestTtsPcmBytes(chunk: Uint8Array, head: any) {
    const combined = state.ttsChunkRemainder.length > 0
        ? appendUint8Arrays(state.ttsChunkRemainder, chunk)
        : chunk;

    const evenLength = combined.length - (combined.length % 2);
    if (evenLength <= 0) {
        state.ttsChunkRemainder = combined.slice();
        return 0;
    }

    const pcmBytes = combined.subarray(0, evenLength);
    state.ttsChunkRemainder = combined.slice(evenLength);
    head.streamAudio({ audio: pcmBytes });
    return pcmBytes.byteLength;
}

function buildEffectiveTtsConfig(config: TTSConfig, settings: TTSRequestSettings): TTSConfig {
    return {
        ...config,
        speed: normalizeTtsSpeed(settings.speed),
        streamingInterval: normalizeTtsStreamingInterval(settings.streamingInterval),
    };
}

function buildTtsRequestPayload(text: string, config: TTSConfig) {
    const payload: Record<string, unknown> = {
        model: config.model,
        input: text,
        stream: true,
        response_format: "pcm",
        ref_text: config.refText,
        lang_code: config.langCode,
        speed: config.speed,
        gender: config.gender,
        streaming_interval: config.streamingInterval,
        temperature: 0.1,
        top_p: 1.0,
        repetition_penalty: 1.2,
        max_tokens: 4096,
    };

    if (config.refAudioPath) {
        payload.ref_audio = config.refAudioPath;
    }

    return payload;
}

async function streamTtsJob(job: TTSQueueItem) {
    let overlayMessageId: string | null = null;

    try {
        const normalizedText = normalizeTtsInput(job.text);
        if (!normalizedText) {
            return;
        }

        const baseConfig = await loadTtsConfig();
        const config = buildEffectiveTtsConfig(baseConfig, {
            speed: job.speed,
            streamingInterval: job.streamingInterval,
        });
        await ensureAvatarReady();

        const head = state.head;
        if (!head) {
            throw new Error("TalkingHead avatar is not ready for TTS playback.");
        }

        activateTtsGate();
        state.ttsRequestActive = true;
        state.ttsAbortController = new AbortController();
        state.ttsChunkRemainder = new Uint8Array(0);
        renderSessionState();
        syncAutoThinkingAnimation();

        const lipsyncLang = currentTalkingHeadLipsyncLang(config);
        const wordTimeline = buildApproximateTtsWordTimeline(normalizedText, config);

        await head.streamStart(
            {
                sampleRate: config.sampleRate,
                lipsyncLang,
                lipsyncType: "words",
                waitForAudioChunks: true,
                gain: 1,
            },
            () => {
                state.ttsPlaying = true;
                renderSessionState();
                syncAutoThinkingAnimation();
            },
            () => {
                state.ttsPlaying = false;
                try {
                    head.streamStop?.();
                } catch { }
                renderSessionState();
                releaseTtsGateIfIdle();
            },
        );

        if (wordTimeline) {
            head.streamAudio({
                words: wordTimeline.words,
                wtimes: wordTimeline.wtimes,
                wdurations: wordTimeline.wdurations,
            });
            appendLog(
                `TalkingHead lipsync queued for ${wordTimeline.words.length} words (${wordTimeline.estimatedDurationMs}ms estimated).`,
            );
        }

        overlayMessageId = appendOverlayMessage("assistant", normalizedText, true);

        const startedAt = performance.now();
        appendLog(`Starting streamed TTS for: ${normalizedText}`);
        traceVoiceAgent("tts stream opening", {
            url: currentTtsUrl(),
            port: config.port,
            text: normalizedText,
            speed: config.speed,
            streamingInterval: config.streamingInterval,
        });

        const response = await fetch(currentTtsUrl(), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(buildTtsRequestPayload(normalizedText, config)),
            signal: state.ttsAbortController.signal,
        });

        if (!response.ok) {
            const body = await response.text();
            throw new Error(
                `TTS request failed with status ${response.status}${body ? `: ${body}` : "."}`,
            );
        }

        if (!response.body) {
            throw new Error("TTS response did not include a readable PCM stream.");
        }

        const reader = response.body.getReader();
        let packetCount = 0;
        let totalBytes = 0;
        let streamedPcmBytes = 0;
        let firstPacketLogged = false;

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }

            if (!value || value.length === 0) {
                continue;
            }

            packetCount += 1;
            totalBytes += value.length;

            if (!firstPacketLogged) {
                firstPacketLogged = true;
                const latencyMs = Math.round(performance.now() - startedAt);
                appendLog(`TTS first PCM packet arrived after ${latencyMs}ms.`);
                traceVoiceAgent("tts<- first pcm", {
                    latencyMs,
                    bytes: value.length,
                });
            }

            if (packetCount === 1 || packetCount % TTS_STREAM_PACKET_DEBUG_INTERVAL === 0) {
                traceVoiceAgent("tts<- pcm", {
                    packetCount,
                    totalBytes,
                    streamedMs: Math.round((streamedPcmBytes / 2 / config.sampleRate) * 1000),
                    playing: state.ttsPlaying,
                });
            }

            streamedPcmBytes += ingestTtsPcmBytes(value, head);
        }

        if (state.ttsChunkRemainder.length > 0) {
            traceVoiceAgent("tts pcm tail dropped", {
                bytes: state.ttsChunkRemainder.length,
            });
            state.ttsChunkRemainder = new Uint8Array(0);
        }

        head.streamNotifyEnd();
        appendLog(`TTS stream finished (${packetCount} PCM packets, ${totalBytes} bytes).`);
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
            traceVoiceAgent("tts stream aborted", { jobId: job.id });
        } else {
            const message = error instanceof Error ? error.message : String(error);
            appendLog(`TTS stream failed: ${message}`);
            setStatus("TTS Playback Failed", message, "destructive");
        }
    } finally {
        setOverlayMessageStreaming(overlayMessageId, false);
        state.ttsAbortController = null;
        state.ttsRequestActive = false;
        state.ttsChunkRemainder = new Uint8Array(0);
        renderSessionState();
        releaseTtsGateIfIdle();
        syncAutoThinkingAnimation();
    }
}

async function pumpTtsQueue() {
    if (!state.sessionActive || state.ttsRequestActive || state.ttsGateActive || state.ttsQueue.length === 0) {
        return;
    }

    const nextJob = state.ttsQueue.shift();
    if (!nextJob) {
        return;
    }

    await streamTtsJob(nextJob);

    if (state.ttsQueue.length > 0) {
        void pumpTtsQueue();
        return;
    }

    releaseTtsGateIfIdle();
}

function queueTtsEcho(text: string) {
    const normalizedText = normalizeTtsInput(text);
    if (!normalizedText || !state.sessionActive) {
        return;
    }

    const requestSettings = currentTtsRequestSettings();
    state.ttsQueue.push({
        id: createOverlayMessageId(),
        text: normalizedText,
        createdAt: Date.now(),
        speed: requestSettings.speed,
        streamingInterval: requestSettings.streamingInterval,
    });
    traceVoiceAgent("tts queued", {
        queueDepth: state.ttsQueue.length,
        text: normalizedText,
        speed: requestSettings.speed,
        streamingInterval: requestSettings.streamingInterval,
    });
    appendLog(
        `Queued transcript for streamed TTS (${normalizedText.length} chars, speed ${formatTtsControlValue(requestSettings.speed)}, stream ${formatTtsControlValue(requestSettings.streamingInterval)}s).`,
    );
    renderSessionState();
    void pumpTtsQueue();
}

function setPill(
    id: string,
    text: string,
    tone: "idle" | "active" | "warn" | "error",
) {
    const element = q(id);
    element.textContent = text;
    element.dataset.tone = tone;
}

function updateTranscriptHistory() {
    const host = q("transcript-history");

    if (state.transcriptHistory.length === 0) {
        $(host).jsx(
            <p class="voice-empty">
                Final utterances will appear here once Aidana confirms a transcript.
            </p>,
        );
        return;
    }

    $(host).jsx(
        <div class="voice-history-list">
            {state.transcriptHistory.map((line, index) => (
                <div class="voice-history-item" key={`${index}:${line}`}>
                    <strong>Utterance {state.transcriptHistory.length - index}</strong>
                    <div>{line}</div>
                </div>
            ))}
        </div>,
    );
}

function updateTranscriptPanels() {
    q("confirmed-transcript").textContent =
        state.confirmedTranscript || "Stable transcript will appear here.";
    q("volatile-transcript").textContent =
        state.volatileTranscript || "Live partial transcript will appear here.";
    updateTranscriptHistory();
}

function updateLevelIndicator() {
    const level = Math.max(0, Math.min(1, state.currentLevel));
    q<HTMLDivElement>("voice-meter-fill").style.width = `${level * 100}%`;
    q("voice-meter-value").textContent = `${Math.round(level * 100)}%`;
}

function renderSessionState() {
    q("selected-microphone").textContent = selectedMicrophoneLabel();
    q("avatar-animation-status").textContent = state.avatarAnimationStatus;
    q("avatar-animation-status").dataset.mode = state.avatarAnimationMode;
    q("voice-inline-status").textContent = state.ttsGateActive
        ? "Aidana is playing streamed local TTS audio and will resume microphone capture automatically when the playback buffer drains."
        : state.sessionActive
            ? "The dedicated window is listening locally and will keep running while this window stays open."
        : state.preparingSession
            ? "Waiting for microphone access and validating the local Aidana ASR runtime."
            : "Activate the session to grant microphone access and start local ASR streaming.";

    setPill(
        "session-pill",
        state.ttsGateActive
            ? "Speaking"
            : state.sessionActive
                ? "Listening"
                : state.preparingSession
                    ? "Preparing"
                    : "Idle",
        state.ttsGateActive
            ? "warn"
            : state.sessionActive
                ? "active"
                : state.preparingSession
                    ? "warn"
                    : "idle",
    );

    setPill(
        "vad-pill",
        state.ttsGateActive
            ? "Paused for TTS"
            : state.utteranceActive
                ? "Speech detected"
                : state.awaitingFinal
                    ? "Finalizing"
                    : "Silence",
        state.ttsGateActive
            ? "warn"
            : state.utteranceActive
                ? "active"
                : state.awaitingFinal
                    ? "warn"
                    : "idle",
    );

    const asrText = state.asrHealthy === false
        ? "ASR offline"
        : state.socketState === "streaming"
            ? "ASR streaming"
            : state.socketState === "waiting"
                ? "Awaiting final"
                : state.asrHealthy === true
                    ? "ASR ready"
                    : "ASR unchecked";

    const asrTone = state.asrHealthy === false
        ? "error"
        : state.socketState === "streaming"
            ? "active"
            : state.socketState === "waiting"
                ? "warn"
                : state.asrHealthy === true
                    ? "active"
                    : "idle";

    setPill("asr-pill", asrText, asrTone);

    q<HTMLButtonElement>("activate-session").disabled =
        state.sessionActive || state.preparingSession;
    q<HTMLButtonElement>("change-microphone").disabled = state.preparingSession;
    q<HTMLButtonElement>("deactivate-session").disabled =
        !state.sessionActive && !state.awaitingFinal;
    q<HTMLButtonElement>("play-thinking-test").disabled =
        !state.avatarReady || state.preparingSession || state.ttsGateActive;
    q<HTMLButtonElement>("tts-reset-defaults").disabled = state.preparingSession;
    syncAvatarSelect();
    syncAsrLanguageSelect();
    syncTtsControlInputs();
    syncVoiceSpaceSelect();
}

function rememberPrerollFrame(frame: Float32Array) {
    state.prerollFrames.push(frame.slice());
    if (state.prerollFrames.length > PRE_ROLL_FRAMES) {
        state.prerollFrames.shift();
    }
}

function resetVoiceActivityGate() {
    state.pendingVoiceFrames = [];
    state.stableVoiceFrames = 0;
}

function sendAsrPayload(payload: ArrayBuffer | string) {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
        return false;
    }

    state.socket.send(payload);

    if (payload instanceof ArrayBuffer) {
        state.pcmPacketsSent += 1;
        if (state.pcmPacketsSent % PCM_PACKET_DEBUG_INTERVAL === 0) {
            traceVoiceAgent("asr-> sent PCM packets", {
                count: state.pcmPacketsSent,
                language: state.selectedAsrLanguage,
                socketState: state.socketState,
            });
        }
    } else {
        traceVoiceAgent("asr-> control", payload);
    }

    return true;
}

function createAsrControlMessage(payload: {
    flush?: boolean;
    language?: string;
    ignoreWakeWord?: boolean;
    consecutive?: boolean;
}) {
    return JSON.stringify(payload);
}

function sendAsrLanguageConfig() {
    const payload = createAsrControlMessage({
        language: state.selectedAsrLanguage,
        ignoreWakeWord: true,
        consecutive: true,
    });
    if (sendAsrPayload(payload)) {
        appendLog(`ASR language hint sent: ${state.selectedAsrLanguage} (wake word bypass, consecutive mode).`);
    }
}

function flushQueuedSocketPayloads() {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
        return;
    }

    while (state.websocketQueue.length > 0) {
        const payload = state.websocketQueue.shift();
        if (payload == null) {
            continue;
        }
        sendAsrPayload(payload);
    }
}

function closeAsrSocket(closeCode = 1000, reason = "Session idle") {
    const socket = state.socket;
    state.socket = null;
    state.websocketQueue = [];
    resetVoiceActivityGate();
    resetAsrDebugCounters();
    state.utteranceActive = false;
    state.awaitingFinal = false;
    state.hangoverFramesRemaining = 0;
    state.socketState = "idle";

    if (!socket) {
        renderSessionState();
        return;
    }

    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(closeCode, reason);
    }

    renderSessionState();
}

function queueAsrFrame(frame: Float32Array) {
    const payload = frame.slice().buffer;

    if (sendAsrPayload(payload)) {
        return;
    }

    state.websocketQueue.push(payload);
}

async function handleAsrMessage(rawData: unknown) {
    const messageText =
        typeof rawData === "string"
            ? rawData
            : rawData instanceof ArrayBuffer
                ? new TextDecoder().decode(rawData)
                : String(rawData);

    const data = JSON.parse(messageText) as {
        text?: string;
        confirmed?: boolean;
        done?: boolean;
    };

    if (typeof data.text !== "string") {
        return;
    }

    state.asrTextPacketCount += 1;
    traceVoiceAgent("asr<- packet", {
        index: state.asrTextPacketCount,
        confirmed: Boolean(data.confirmed),
        done: Boolean(data.done),
        text: data.text,
    });
    logAsrTokenDelta(data.text);

    if (data.done) {
        const finalText = data.text.trim();
        if (finalText) {
            state.transcriptHistory = [finalText, ...state.transcriptHistory].slice(0, 10);
            appendLog(`Final transcript: ${finalText}`);
        } else {
            appendLog("Aidana returned an empty final transcript.");
        }

        finalizeStreamingUserOverlay(finalText);
        if (finalText) {
            queueTtsEcho(finalText);
        }

        state.confirmedTranscript = "";
        state.volatileTranscript = "";
        state.awaitingFinal = false;
        state.socketState = "idle";
        updateTranscriptPanels();
        closeAsrSocket(1000, "Utterance complete");
        syncAutoThinkingAnimation();
        setStatus(
            "Listening",
            "Aidana is ready for the next utterance. Speak again whenever you are ready.",
        );
        return;
    }

    if (data.confirmed) {
        state.confirmedTranscript = data.text;
        state.volatileTranscript = "";
    } else {
        state.volatileTranscript = data.text;
    }

    syncStreamingUserOverlay(data.text);
    updateTranscriptPanels();
}

function openAsrSocket() {
    if (state.socket || !state.sessionActive) {
        return;
    }

    const socket = new WebSocket(ASR_URL);
    socket.binaryType = "arraybuffer";
    state.socket = socket;
    state.socketState = "connecting";
    renderSessionState();
    appendLog("Opening Aidana ASR websocket.");
    traceVoiceAgent("asr socket opening", {
        url: ASR_URL,
        language: state.selectedAsrLanguage,
    });

    socket.onopen = () => {
        if (state.socket !== socket) {
            socket.close(1000, "Superseded");
            return;
        }

        state.socketState = state.awaitingFinal ? "waiting" : "streaming";
        sendAsrLanguageConfig();
        flushQueuedSocketPayloads();
        renderSessionState();
        appendLog("Aidana ASR websocket is open.");
        traceVoiceAgent("asr socket open", {
            awaitingFinal: state.awaitingFinal,
            queuedPayloads: state.websocketQueue.length,
        });
    };

    socket.onmessage = (event) => {
        void handleAsrMessage(event.data);
    };

    socket.onerror = (event) => {
        if (state.socket !== socket) {
            return;
        }

        traceVoiceAgent("asr socket error", event);

        finalizeStreamingUserOverlay(currentStreamingUtteranceText());
        state.asrHealthy = false;
        state.socketState = "error";
        state.utteranceActive = false;
        state.awaitingFinal = false;
        state.websocketQueue = [];
        renderSessionState();
        syncAutoThinkingAnimation();
        setStatus(
            "ASR Connection Error",
            "Aidana could not keep the localhost ASR websocket open. Check that the local runtime is still healthy.",
            "destructive",
        );
        appendLog("ASR websocket error.");
    };

    socket.onclose = (event) => {
        const wasCurrentSocket = state.socket === socket;
        if (!wasCurrentSocket) {
            return;
        }

        traceVoiceAgent("asr socket close", {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
        });

        state.socket = null;
        state.websocketQueue = [];
        state.utteranceActive = false;
        state.awaitingFinal = false;
        state.hangoverFramesRemaining = 0;
        state.socketState = state.sessionActive ? "idle" : "error";
        finalizeStreamingUserOverlay(currentStreamingUtteranceText());
        renderSessionState();
        syncAutoThinkingAnimation();

        if (!state.destroying && state.sessionActive && event.code !== 1000) {
            setStatus(
                "ASR Closed Unexpectedly",
                `Aidana closed the websocket with code ${event.code}. The session is still open, but the next utterance will create a fresh stream.`,
                "destructive",
            );
            appendLog(`ASR websocket closed unexpectedly (${event.code}).`);
        }
    };
}

function beginUtterance(
    bufferedFrames: Float32Array[] = state.prerollFrames,
    trigger: "stable-window" | "short-utterance" = "stable-window",
) {
    if (!state.sessionActive || state.utteranceActive || state.awaitingFinal) {
        return;
    }

    state.utteranceActive = true;
    state.awaitingFinal = false;
    state.hangoverFramesRemaining = HANGOVER_FRAMES;
    state.socketState = "connecting";
    state.websocketQueue = bufferedFrames.map((frame) => frame.slice().buffer);
    resetVoiceActivityGate();
    resetAsrDebugCounters();
    state.overlayAutoScrollPinned = true;
    renderSessionState();
    syncAutoThinkingAnimation();
    traceVoiceAgent("utterance started", {
        trigger,
        bufferedFrames: bufferedFrames.length,
        streamDelayMs: VOICE_ACTIVITY_STREAM_DELAY_MS,
    });
    if (trigger === "short-utterance") {
        appendLog(
            `Short utterance ended before ${VOICE_ACTIVITY_STREAM_DELAY_MS}ms. Replaying buffered audio to Aidana ASR.`,
        );
    } else {
        appendLog(
            `Voice stayed active for ${VOICE_ACTIVITY_STREAM_DELAY_MS}ms. Opening utterance stream.`,
        );
    }
    openAsrSocket();
}

function flushUtterance() {
    if (!state.utteranceActive || state.awaitingFinal) {
        return;
    }

    state.utteranceActive = false;
    state.awaitingFinal = true;
    state.hangoverFramesRemaining = 0;
    state.socketState = state.socket?.readyState === WebSocket.OPEN
        ? "waiting"
        : "connecting";
    syncAutoThinkingAnimation();

    traceVoiceAgent("utterance flushing", {
        pcmPacketsSent: state.pcmPacketsSent,
        asrTextPacketCount: state.asrTextPacketCount,
    });

    const flushPayload = JSON.stringify({ flush: true });
    if (sendAsrPayload(flushPayload)) {
        appendLog("Voice end detected. Flushing utterance to Aidana ASR.");
    } else {
        state.websocketQueue.push(flushPayload);
        appendLog("Voice end detected. Queueing utterance flush for Aidana ASR.");
    }

    renderSessionState();
}

function maybeStartUtterance(frame: Float32Array, result: VoiceDetectionResult) {
    if (!state.sessionActive || state.utteranceActive || state.awaitingFinal) {
        return false;
    }

    if (!result.isVoiceStable) {
        if (state.stableVoiceFrames > 0 && !result.onVoiceEnd) {
            resetVoiceActivityGate();
        }
        return false;
    }

    if (state.stableVoiceFrames === 0) {
        state.pendingVoiceFrames = state.prerollFrames.map((item) => item.slice());
    }

    state.stableVoiceFrames += 1;
    state.pendingVoiceFrames.push(frame.slice());

    if (state.stableVoiceFrames < VOICE_ACTIVITY_STREAM_DELAY_FRAMES) {
        return false;
    }

    beginUtterance(state.pendingVoiceFrames, "stable-window");
    return true;
}

function flushBufferedShortUtterance() {
    if (
        !state.sessionActive ||
        state.utteranceActive ||
        state.awaitingFinal ||
        state.pendingVoiceFrames.length === 0
    ) {
        resetVoiceActivityGate();
        return false;
    }

    if (state.stableVoiceFrames < SHORT_UTTERANCE_FALLBACK_MIN_FRAMES) {
        appendLog(
            `Discarding buffered speech shorter than ${SHORT_UTTERANCE_FALLBACK_MIN_MS}ms.`,
        );
        resetVoiceActivityGate();
        return false;
    }

    beginUtterance(state.pendingVoiceFrames, "short-utterance");
    flushUtterance();
    return true;
}

function findMouthMesh(head: any) {
    if (mouthMesh) {
        return;
    }

    const root = head.avatar ?? head.model;
    if (!root?.traverse) {
        return;
    }

    root.traverse((object: any) => {
        if (mouthMesh) {
            return;
        }

        if (!object.morphTargetDictionary || !object.morphTargetInfluences) {
            return;
        }

        if (
            "jawOpen" in object.morphTargetDictionary ||
            "mouthOpen" in object.morphTargetDictionary
        ) {
            mouthMesh = object;
            mouthTargets = object.morphTargetDictionary;
        }
    });
}

function applyMouthMorph(value: number) {
    if (!mouthMesh) {
        return;
    }

    const jawIndex = mouthTargets.jawOpen;
    if (jawIndex !== undefined) {
        mouthMesh.morphTargetInfluences[jawIndex] = value * 0.7;
    }

    const mouthIndex = mouthTargets.mouthOpen;
    if (mouthIndex !== undefined) {
        mouthMesh.morphTargetInfluences[mouthIndex] = value * 0.4;
    }
}

function mouthAnimationLoop() {
    updateLevelIndicator();
    requestAnimationFrame(mouthAnimationLoop);
}

function ensureAnimationLoop() {
    if (animationLoopStarted) {
        return;
    }

    animationLoopStarted = true;
    requestAnimationFrame(mouthAnimationLoop);
}

async function playThinkingTestAnimation() {
    if (!state.head || !state.avatarReady) {
        appendLog("Thinking animation test ignored because the avatar is not ready yet.");
        return;
    }

    appendLog(`Playing thinking animation for ${THINKING_ANIMATION_DURATION_SECONDS}s.`);
    traceVoiceAgent("avatar animation test", {
        name: "thinking",
        durationSeconds: THINKING_ANIMATION_DURATION_SECONDS,
        avatarId: state.currentAvatarId,
    });
    scheduleAvatarThinkingCycle("manual", `Manual thinking test (${THINKING_ANIMATION_DURATION_SECONDS}s)`);
}

function resetAvatarStage() {
    resetAvatarAnimationState(false);

    try {
        state.head?.stop?.();
    } catch { }

    state.head = null;
    state.avatarReady = false;
    state.loadedAvatarId = null;
    mouthMesh = null;
    mouthTargets = {};
    targetMouthValue = 0;
    currentMouthValue = 0;

    const stage = document.getElementById("avatar-canvas-stage");
    if (stage) {
        stage.innerHTML = "";
    }
}

async function ensureAvatarReady() {
    const avatar = currentAvatar();
    const lipsyncLang = currentTalkingHeadLipsyncLang();
    if (state.avatarReady && state.head && state.loadedAvatarId === avatar.id) {
        return;
    }

    if (state.loadedAvatarId && state.loadedAvatarId !== avatar.id) {
        appendLog(`Switching avatar to ${avatar.label}.`);
        resetAvatarStage();
    }

    const stage = q("avatar-canvas-stage");
    stage.innerHTML = "";

    setStatus(
        "Loading Avatar",
        `Preparing ${avatar.label} for the dedicated voice session window.`,
    );
    appendLog(`Loading avatar ${avatar.label}.`);

    const head = new TalkingHead(stage, {
        cameraView: "upper",
        avatarMood: "neutral",
        lipsyncLang,
        lipsyncModules: [],
        modelFPS: 60,
        cameraRotateX: 0.1,
        postureChangePerSec: 0,
        bodyMoveFactor: 0,
    });

    ensureTalkingHeadLipsyncModules(head);

    await head.showAvatar(
        {
            url: avatar.url,
            body: avatar.body,
            avatarMood: "neutral",
            lipsyncLang,
            ttsLang: "en-US",
            baseline: {
                headRotateX: -0.02,
                spineRotateX: -0.05,
                chestRotateX: -0.03,
                eyeBlinkLeft: 0.15,
                eyeBlinkRight: 0.15,
                eyeLookInLeft: 0.1,
                eyeLookInRight: 0.1,
                eyeLookDownLeft: 0.05,
                eyeLookDownRight: 0.05,
            },
        },
        () => {
            appendLog("Avatar asset loaded.");
        },
    );

    state.head = head;
    state.avatarReady = true;
    state.loadedAvatarId = avatar.id;
    findMouthMesh(head);
    ensureAnimationLoop();
    void applyCurrentVoiceSpace();
    syncAutoThinkingAnimation();
}

async function teardownAudioSession() {
    stopScheduledTtsSources();

    try {
        state.processor?.disconnect();
    } catch { }

    try {
        state.source?.disconnect();
    } catch { }

    try {
        state.muteNode?.disconnect();
    } catch { }

    if (state.micStream) {
        for (const track of state.micStream.getTracks()) {
            track.stop();
        }
    }

    if (state.audioCtx) {
        try {
            await state.audioCtx.close();
        } catch { }
    }

    state.micStream = null;
    state.audioCtx = null;
    state.source = null;
    state.processor = null;
    state.muteNode = null;
    state.residual = new Float32Array(0);
    state.ttsOutputNode = null;
    state.ttsDryNode = null;
    state.ttsWetNode = null;
    state.ttsConvolverNode = null;
    state.ttsAnalyserNode = null;
    state.ttsAppliedVoiceSpace = null;
    ttsAnalyserSamples = null;
    resetTtsPendingBuffers();
}

function destroyDetector() {
    if (state.detector) {
        state.detector.destroy();
        state.detector = null;
    }
}

async function refreshMicrophones() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    state.microphones = devices
        .filter((device) => device.kind === "audioinput")
        .map((device, index) => ({
            deviceId: device.deviceId,
            label:
                device.label ||
                (device.deviceId === "default"
                    ? "System default microphone"
                    : `Microphone ${index + 1}`),
        }));

    if (
        state.selectedDeviceId &&
        !state.microphones.some((device) => device.deviceId === state.selectedDeviceId)
    ) {
        state.selectedDeviceId = state.microphones[0]?.deviceId ?? null;
    }

    renderSessionState();
}

function resolveSelectedDeviceId(
    stream: MediaStream,
    requestedDeviceId: string | null,
): string | null {
    const track = stream.getAudioTracks()[0];
    const activeDeviceId = track?.getSettings().deviceId;

    if (typeof activeDeviceId === "string" && activeDeviceId.length > 0) {
        return activeDeviceId;
    }

    const activeLabel = track?.label?.trim();
    if (activeLabel) {
        const match = state.microphones.find((device) => device.label === activeLabel);
        if (match) {
            return match.deviceId;
        }
    }

    return requestedDeviceId;
}

async function assertAsrReady() {
    const response = await fetch(HEALTH_URL, { cache: "no-store" });
    if (!response.ok) {
        throw new Error(`Aidana health check failed with status ${response.status}.`);
    }

    const data = (await response.json()) as {
        status?: string;
        asr_ready?: boolean;
    };

    if (data.status !== "ok") {
        throw new Error("Aidana reported an unhealthy runtime state.");
    }

    if (data.asr_ready !== true) {
        throw new Error("Aidana ASR is not ready yet. Start the local runtime first.");
    }

    state.asrHealthy = true;
}

function handleVoiceFrame(frame: Float32Array, result: VoiceDetectionResult) {
    state.currentLevel = Math.min(1, result.rms * 8);
    targetMouthValue = result.isVoiceStable ? Math.min(1, result.rms * 6) : 0;

    const startedUtterance = maybeStartUtterance(frame, result);

    if (result.onVoiceStart) {
        renderSessionState();
    }

    if (state.utteranceActive) {
        if (result.isVoiceStable) {
            state.hangoverFramesRemaining = HANGOVER_FRAMES;
        } else if (state.hangoverFramesRemaining > 0) {
            state.hangoverFramesRemaining -= 1;
        }

        if (!startedUtterance) {
            queueAsrFrame(frame);
        }

        if (!result.isVoiceStable && state.hangoverFramesRemaining === 0) {
            flushUtterance();
            renderSessionState();
        }
    }

    if (result.onVoiceEnd) {
        if (!state.utteranceActive && !startedUtterance) {
            flushBufferedShortUtterance();
        }
        renderSessionState();
    }

    rememberPrerollFrame(frame);
}

async function startVoiceSession(deviceId: string | null) {
    const requestedDeviceId =
        deviceId && deviceId !== "default" && deviceId.length > 0 ? deviceId : null;

    try {
        state.preparingSession = true;
        renderSessionState();

        setStatus(
            "Requesting Microphone",
            "Approve microphone access in the browser prompt to start the dedicated voice session.",
        );

        destroyDetector();

        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: requestedDeviceId ? { exact: requestedDeviceId } : undefined,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            },
        });

        state.micStream = stream;
        await WorkerRpc.setPrefValue(MIC_PERMISSION_PREF_KEY, true, true);
        await refreshMicrophones();

        const resolvedDeviceId = resolveSelectedDeviceId(stream, requestedDeviceId);
        state.selectedDeviceId = resolvedDeviceId;
        await WorkerRpc.setPrefValue(DEVICE_PREF_KEY, resolvedDeviceId ?? "", true);

        await Promise.all([ensureAvatarReady(), assertAsrReady()]);

        state.detector = await createVoiceDetector(VOICE_DETECTOR_TUNING);
        appendLog(
            `VoiceDetector ready (threshold ${VOICE_DETECTOR_TUNING.threshold ?? VOICE_DETECTOR_DEFAULTS.threshold}, RMS floor ${VOICE_DETECTOR_TUNING.rmsFloor ?? VOICE_DETECTOR_DEFAULTS.rmsFloor}, debounce on ${VOICE_DETECTOR_TUNING.debounceOn ?? VOICE_DETECTOR_DEFAULTS.debounceOn}, debounce off ${VOICE_DETECTOR_TUNING.debounceOff ?? VOICE_DETECTOR_DEFAULTS.debounceOff}, end-of-speech grace ${END_OF_SPEECH_GRACE_MS}ms).`,
        );

        const audioCtx = new AudioContext();
        await audioCtx.resume();

        const source = audioCtx.createMediaStreamSource(stream);
        const processor = audioCtx.createScriptProcessor(4096, 1, 1);
        const muteNode = audioCtx.createGain();
        muteNode.gain.value = 0;

        source.connect(processor);
        processor.connect(muteNode);
        muteNode.connect(audioCtx.destination);

        const nativeRate = audioCtx.sampleRate;
        const ratio = nativeRate / TARGET_SAMPLE_RATE;

        processor.onaudioprocess = (event) => {
            if (state.ttsGateActive) {
                state.residual = new Float32Array(0);
                return;
            }

            if (!state.sessionActive || !state.detector) {
                return;
            }

            const input = event.inputBuffer.getChannelData(0);
            const combined = new Float32Array(state.residual.length + input.length);
            combined.set(state.residual);
            combined.set(input, state.residual.length);

            let offset = 0;
            const samplesNeeded = Math.ceil(HOP_SIZE * ratio);

            while (offset + samplesNeeded <= combined.length) {
                const frame = new Float32Array(HOP_SIZE);
                const int16 = new Int16Array(HOP_SIZE);

                for (let index = 0; index < HOP_SIZE; index++) {
                    const sourceIndex = offset + index * ratio;
                    const low = Math.floor(sourceIndex);
                    const high = Math.min(low + 1, combined.length - 1);
                    const fraction = sourceIndex - low;
                    const sample = combined[low] * (1 - fraction) + combined[high] * fraction;

                    frame[index] = sample;
                    int16[index] = Math.max(
                        -32768,
                        Math.min(32767, Math.round(sample * 32768)),
                    );
                }

                offset += samplesNeeded;

                const result = state.detector.process(int16) as VoiceDetectionResult;
                handleVoiceFrame(frame, result);
            }

            state.residual = combined.slice(offset);
        };

        state.micStream = stream;
        state.audioCtx = audioCtx;
        state.source = source;
        state.processor = processor;
        state.muteNode = muteNode;
        state.residual = new Float32Array(0);
        state.prerollFrames = [];
        resetVoiceActivityGate();
        state.sessionActive = true;
        state.preparingSession = false;
        state.socketState = "idle";
        state.confirmedTranscript = "";
        state.volatileTranscript = "";
        state.selectedDeviceId = resolvedDeviceId;
        clearStreamingUserOverlay();

        updateTranscriptPanels();
        renderSessionState();
        syncAutoThinkingAnimation();
        void applyCurrentVoiceSpace();

        const microphoneName = activeMicrophoneLabel() ?? "the selected microphone";
        setListeningStatus();
        appendLog(
            `Voice session started (${nativeRate} Hz input -> ${TARGET_SAMPLE_RATE} Hz ASR) using ${microphoneName}.`,
        );
        void loadTtsConfig().catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            appendLog(`TTS config warmup failed: ${message}`);
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (
            error instanceof DOMException &&
            (error.name === "NotAllowedError" || error.name === "PermissionDeniedError")
        ) {
            await WorkerRpc.setPrefValue(MIC_PERMISSION_PREF_KEY, false, true);
        }

        state.sessionActive = false;
        state.preparingSession = false;
        if (/asr|health|runtime/i.test(message)) {
            state.asrHealthy = false;
        }
        clearStreamingUserOverlay();
        state.confirmedTranscript = "";
        state.volatileTranscript = "";
        updateTranscriptPanels();
        renderSessionState();
        setStatus(
            "Voice Session Failed",
            message,
            "destructive",
        );
        appendLog(`Voice session failed: ${message}`);
        stopTtsPlayback("Stopped local TTS playback.");
        await teardownAudioSession();
        destroyDetector();
        closeAsrSocket(1011, "Startup failed");
    }
}

async function stopVoiceSession(reason: string) {
    state.sessionActive = false;
    state.preparingSession = false;
    state.awaitingFinal = false;
    state.utteranceActive = false;
    resetVoiceActivityGate();
    state.currentLevel = 0;
    targetMouthValue = 0;
    currentMouthValue = 0;
    state.confirmedTranscript = "";
    state.volatileTranscript = "";
    updateLevelIndicator();
    applyMouthMorph(0);
    clearStreamingUserOverlay();
    stopTtsPlayback("Stopped local TTS playback.");
    updateTranscriptPanels();

    await teardownAudioSession();
    destroyDetector();
    closeAsrSocket(1000, "Session stopped");

    setStatus("Session Stopped", reason);
    appendLog(reason);
    renderSessionState();
}

async function activateVoiceSession() {
    await startVoiceSession(state.selectedDeviceId);
}

async function changeMicrophone() {
    if (state.sessionActive || state.awaitingFinal) {
        await stopVoiceSession("Voice session paused while switching microphone.");
    }

    state.selectedDeviceId = null;
    renderSessionState();

    await WorkerRpc.setPrefValue(DEVICE_PREF_KEY, "", true);
    await startVoiceSession(null);
}

async function selectAsrLanguage(languageId: string) {
    const nextLanguage = ASR_LANGUAGES.find((item) => item.id === languageId);
    if (!nextLanguage || nextLanguage.id === state.selectedAsrLanguage) {
        syncAsrLanguageSelect();
        return;
    }

    state.selectedAsrLanguage = nextLanguage.id;
    state.asrLanguageDirty = true;
    renderSessionState();
    await WorkerRpc.setPrefValue(ASR_LANGUAGE_PREF_KEY, nextLanguage.id, true);

    appendLog(
        `ASR language hint set to ${nextLanguage.label}.${state.sessionActive ? " It will apply to the next utterance." : ""}`,
    );
}

async function selectTtsSpeed(rawValue: string) {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
        syncTtsControlInputs();
        return;
    }

    const nextSpeed = normalizeTtsSpeed(parsed);
    if (nextSpeed === state.selectedTtsSpeed) {
        syncTtsControlInputs();
        return;
    }

    state.selectedTtsSpeed = nextSpeed;
    state.ttsSpeedDirty = true;
    renderSessionState();
    await WorkerRpc.setPrefValue(TTS_SPEED_PREF_KEY, nextSpeed, true);
    appendLog(`TTS speed set to ${formatTtsControlValue(nextSpeed)}. Newly queued speech will use it.`);
}

async function selectTtsStreamingInterval(rawValue: string) {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
        syncTtsControlInputs();
        return;
    }

    const nextStreamingInterval = normalizeTtsStreamingInterval(parsed);
    if (nextStreamingInterval === state.selectedTtsStreamingInterval) {
        syncTtsControlInputs();
        return;
    }

    state.selectedTtsStreamingInterval = nextStreamingInterval;
    state.ttsStreamingIntervalDirty = true;
    renderSessionState();
    await WorkerRpc.setPrefValue(TTS_STREAMING_INTERVAL_PREF_KEY, nextStreamingInterval, true);
    appendLog(
        `TTS stream interval set to ${formatTtsControlValue(nextStreamingInterval)}s. Newly queued speech will use it.`,
    );
}

async function resetTtsRequestSettings() {
    let config = state.ttsConfig;

    try {
        config = await loadTtsConfig(true);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        appendLog(`TTS defaults refresh failed, using last known defaults: ${message}`);
    }

    const nextSpeed = normalizeTtsSpeed(config?.speed ?? DEFAULT_TTS_SPEED);
    const nextStreamingInterval = normalizeTtsStreamingInterval(
        config?.streamingInterval ?? DEFAULT_TTS_STREAMING_INTERVAL,
    );

    state.selectedTtsSpeed = nextSpeed;
    state.ttsSpeedDirty = false;
    state.selectedTtsStreamingInterval = nextStreamingInterval;
    state.ttsStreamingIntervalDirty = false;
    renderSessionState();

    await Promise.all([
        WorkerRpc.setPrefValue(TTS_SPEED_PREF_KEY, null, true),
        WorkerRpc.setPrefValue(TTS_STREAMING_INTERVAL_PREF_KEY, null, true),
    ]);

    appendLog(
        `TTS controls reset to Aidana defaults (${formatTtsControlValue(nextSpeed)}, ${formatTtsControlValue(nextStreamingInterval)}s).`,
    );
}

async function selectVoiceSpace(spaceId: string) {
    const nextSpace = VOICE_SPACES.find((item) => item.id === spaceId);
    if (!nextSpace || nextSpace.id === state.selectedVoiceSpace) {
        syncVoiceSpaceSelect();
        return;
    }

    state.selectedVoiceSpace = nextSpace.id;
    renderSessionState();
    await WorkerRpc.setPrefValue(VOICE_SPACE_PREF_KEY, nextSpace.id, true);

    appendLog(
        `Voice space set to ${nextSpace.label}.${state.sessionActive ? "" : " It will apply the next time Aidana speaks."}`,
    );

    await applyCurrentVoiceSpace();
}

async function selectAvatar(avatarId: string) {
    const avatar = AVATARS.find((item) => item.id === avatarId);
    if (!avatar || avatar.id === state.currentAvatarId) {
        syncAvatarSelect();
        return;
    }

    state.currentAvatarId = avatar.id;
    state.avatarReady = false;
    renderSessionState();

    await WorkerRpc.setPrefValue(AVATAR_PREF_KEY, avatar.id, true);

    try {
        await ensureAvatarReady();
        appendLog(`Avatar ${avatar.label} is ready.`);

        if (!state.sessionActive && !state.preparingSession) {
            setStatus(
                "Avatar Ready",
                `${avatar.label} is loaded locally and ready for activation.`,
            );
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus("Avatar Load Failed", message, "destructive");
        appendLog(`Avatar load failed: ${message}`);
    }
}

const App: FC = () => (
    <main class="voice-agent-shell">
        <section class="voice-side">
            <div class="voice-side-scroll">
                <Card>
                    <CardHeader class="space-y-5">
                        <div class="voice-kicker">Aidana local voice runtime</div>
                        <div class="voice-hero-copy">
                            <h1>Dedicated Voice Session</h1>
                            <p>
                                This window keeps microphone capture, streamed utterances, and
                                the 3D scene alive while the toolbar popup comes and goes.
                            </p>
                        </div>
                        <div class="voice-action-row">
                            <Button
                                id="activate-session"
                                onClick={() => {
                                    void activateVoiceSession();
                                }}
                            >
                                Activate Session
                            </Button>
                            <Button
                                id="change-microphone"
                                variant="outline"
                                onClick={() => {
                                    void changeMicrophone();
                                }}
                            >
                                Change Microphone
                            </Button>
                            <Button
                                id="deactivate-session"
                                variant="secondary"
                                onClick={() => {
                                    void stopVoiceSession("Voice session manually stopped.");
                                }}
                            >
                                Deactivate
                            </Button>
                        </div>
                        <div class="voice-note">
                            Aidana ASR endpoint: {ASR_URL}. Only VAD-detected utterances are
                            streamed to localhost, and this window preserves the session while
                            it stays open.
                        </div>
                    </CardHeader>
                </Card>

                <div id="voice-status">
                    <Alert>
                        <AlertTitle>Ready To Activate</AlertTitle>
                        <AlertDescription>
                            Click Activate Session, approve microphone access, then start speaking.
                        </AlertDescription>
                    </Alert>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Session Signals</CardTitle>
                        <CardDescription>
                            Voice activity, websocket state, and selected input are tracked
                            here while the dedicated session window is running.
                        </CardDescription>
                    </CardHeader>
                    <CardContent class="space-y-4">
                        <div class="voice-pill-row">
                            <div id="session-pill" class="voice-pill" data-tone="idle">
                                Idle
                            </div>
                            <div id="vad-pill" class="voice-pill" data-tone="idle">
                                Silence
                            </div>
                            <div id="asr-pill" class="voice-pill" data-tone="idle">
                                ASR unchecked
                            </div>
                        </div>
                        <Separator />
                        <div class="voice-device-summary">
                            <div class="voice-device-chip">
                                <strong>Selected microphone</strong>
                                <span id="selected-microphone">No microphone selected yet</span>
                            </div>
                            <div id="voice-inline-status" class="voice-inline-status">
                                Activate the session to grant microphone access and start local
                                ASR streaming.
                            </div>
                            <div class="voice-animation-status">
                                <strong>Avatar animation</strong>
                                <span
                                    id="avatar-animation-status"
                                    class="voice-animation-badge"
                                    data-mode="idle"
                                >
                                    Idle loop
                                </span>
                            </div>
                            <div class="voice-test-action-row">
                                <Button
                                    id="play-thinking-test"
                                    variant="outline"
                                    onClick={() => {
                                        void playThinkingTestAnimation();
                                    }}
                                >
                                    Play Thinking (2s)
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Voice Space</CardTitle>
                        <CardDescription>
                            Apply a local impulse response to Aidana speech playback. This
                            affects TTS only and keeps microphone capture dry.
                        </CardDescription>
                    </CardHeader>
                    <CardContent class="space-y-4">
                        <div class="grid gap-2">
                            <Label htmlFor="voice-space-select">Impulse Response</Label>
                            <select id="voice-space-select" class="voice-device-select">
                                {VOICE_SPACES.map((space) => (
                                    <option value={space.id}>{space.label}</option>
                                ))}
                            </select>
                        </div>
                        <div class="voice-inline-status">
                            None leaves playback dry. Basement, Church, Forest, and Room use
                            the packaged TalkingHead impulse responses.
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Transcripts</CardTitle>
                        <CardDescription>
                            Live partial text appears first. Confirmed utterances move into
                            the history feed when Aidana finalizes them.
                        </CardDescription>
                    </CardHeader>
                    <CardContent class="voice-transcript-stack">
                        <div class="voice-live-panel">
                            <div class="voice-panel-header">
                                <strong>Live utterance</strong>
                                <span>Partial plus confirmed text</span>
                            </div>
                            <div id="confirmed-transcript" class="voice-live-confirmed">
                                Stable transcript will appear here.
                            </div>
                            <div id="volatile-transcript" class="voice-live-volatile">
                                Live partial transcript will appear here.
                            </div>
                        </div>

                        <div class="voice-history-panel">
                            <div class="voice-panel-header">
                                <strong>Confirmed history</strong>
                                <span>Most recent utterances first</span>
                            </div>
                            <div id="transcript-history">
                                <p class="voice-empty">
                                    Final utterances will appear here once Aidana confirms a
                                    transcript.
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Runtime Log</CardTitle>
                        <CardDescription>
                            Useful when microphone permission, avatar loading, or localhost
                            ASR needs debugging.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <pre id="voice-log" class="voice-log" />
                    </CardContent>
                </Card>
            </div>
        </section>

        <section class="voice-stage-card">
            <Card class="voice-stage-card">
                <CardContent class="voice-stage-wrap p-5">
                    <div class="voice-stage-toolbar">
                        <div class="voice-stage-selectors">
                            <div class="voice-avatar-picker">
                                <Label htmlFor="avatar-select">Avatar</Label>
                                <select id="avatar-select" class="voice-device-select voice-avatar-select">
                                    {AVATARS.map((avatar) => (
                                        <option value={avatar.id}>{avatar.label}</option>
                                    ))}
                                </select>
                            </div>

                            <div class="voice-avatar-picker">
                                <Label htmlFor="asr-language-select">ASR Language</Label>
                                <select id="asr-language-select" class="voice-device-select voice-avatar-select">
                                    {ASR_LANGUAGES.map((language) => (
                                        <option value={language.id}>{language.label}</option>
                                    ))}
                                </select>
                            </div>

                            <div class="voice-avatar-picker">
                                <Label htmlFor="tts-speed-input">TTS Speed</Label>
                                <input
                                    id="tts-speed-input"
                                    class="voice-device-select voice-avatar-select"
                                    type="number"
                                    min={MIN_TTS_SPEED}
                                    max={MAX_TTS_SPEED}
                                    step="0.05"
                                    inputMode="decimal"
                                />
                            </div>

                            <div class="voice-avatar-picker">
                                <Label htmlFor="tts-streaming-interval-input">TTS Stream Int.</Label>
                                <input
                                    id="tts-streaming-interval-input"
                                    class="voice-device-select voice-avatar-select"
                                    type="number"
                                    min={MIN_TTS_STREAMING_INTERVAL}
                                    max={MAX_TTS_STREAMING_INTERVAL}
                                    step="0.05"
                                    inputMode="decimal"
                                />
                            </div>
                        </div>

                        <div class="voice-stage-note">
                            TTS Speed and Stream Int. initialize from Aidana Preferences. Each
                            queued utterance snapshots the current values, so later changes only
                            affect newly queued speech.
                        </div>
                        <div class="voice-stage-note-actions">
                            <Button
                                id="tts-reset-defaults"
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                    void resetTtsRequestSettings();
                                }}
                            >
                                Reset To Aidana Defaults
                            </Button>
                        </div>
                    </div>

                    <div id="avatar-stage" class="avatar-stage">
                        <div id="avatar-canvas-stage" class="avatar-canvas-stage">
                            <div class="avatar-placeholder">
                                <div>
                                    <strong>Aidana talking head</strong>
                                    <div>
                                        Activate the session to load the selected 3D avatar and bind
                                        mouth movement to local voice activity.
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="voice-overlay-shell">
                            <div id="voice-overlay-left" class="voice-overlay-lane voice-overlay-lane-left">
                                <div id="voice-overlay-scroll" class="voice-overlay-scroll">
                                    <div id="voice-overlay-stream" class="voice-overlay-stream" />
                                </div>
                            </div>
                            <div class="voice-overlay-lane voice-overlay-lane-right" />
                        </div>
                    </div>

                    <div class="voice-meter">
                        <div class="voice-meter-header">
                            <Label>Voice activity level</Label>
                            <span id="voice-meter-value">0%</span>
                        </div>
                        <div class="voice-meter-track">
                            <div id="voice-meter-fill" class="voice-meter-fill" />
                        </div>
                    </div>
                </CardContent>
            </Card>
        </section>
    </main>
);

render(<App />, document.getElementById("app")!);

q<HTMLSelectElement>("avatar-select").addEventListener("change", (event) => {
    const nextAvatarId = (event.currentTarget as HTMLSelectElement).value;
    void selectAvatar(nextAvatarId);
});

q<HTMLSelectElement>("asr-language-select").addEventListener("change", (event) => {
    const nextLanguageId = (event.currentTarget as HTMLSelectElement).value;
    void selectAsrLanguage(nextLanguageId);
});

q<HTMLInputElement>("tts-speed-input").addEventListener("change", (event) => {
    void selectTtsSpeed((event.currentTarget as HTMLInputElement).value);
});

q<HTMLInputElement>("tts-streaming-interval-input").addEventListener("change", (event) => {
    void selectTtsStreamingInterval((event.currentTarget as HTMLInputElement).value);
});

q<HTMLSelectElement>("voice-space-select").addEventListener("change", (event) => {
    const nextSpaceId = (event.currentTarget as HTMLSelectElement).value;
    void selectVoiceSpace(nextSpaceId);
});

updateTranscriptPanels();
renderOverlayMessages();
updateLevelIndicator();
renderSessionState();

const overlayScrollHost = document.getElementById("voice-overlay-scroll") as HTMLDivElement | null;
overlayScrollHost?.addEventListener("scroll", () => {
    state.overlayAutoScrollPinned = isOverlayNearBottom(overlayScrollHost);
});

const voiceAgentConfigStatus = await initializeVoiceAgentConfig();

const savedDevice = await WorkerRpc.getPrefValue(DEVICE_PREF_KEY, true);
if (typeof savedDevice === "string" && savedDevice.length > 0) {
    state.selectedDeviceId = savedDevice;
}

const savedAvatar = await WorkerRpc.getPrefValue(AVATAR_PREF_KEY, true);
if (
    typeof savedAvatar === "string" &&
    AVATARS.some((avatar) => avatar.id === savedAvatar)
) {
    state.currentAvatarId = savedAvatar;
}

const savedTtsSpeed = await WorkerRpc.getPrefValue(TTS_SPEED_PREF_KEY, true);
if (typeof savedTtsSpeed === "number" && Number.isFinite(savedTtsSpeed)) {
    state.selectedTtsSpeed = normalizeTtsSpeed(savedTtsSpeed);
    state.ttsSpeedDirty = true;
}

const savedTtsStreamingInterval = await WorkerRpc.getPrefValue(
    TTS_STREAMING_INTERVAL_PREF_KEY,
    true,
);
if (
    typeof savedTtsStreamingInterval === "number" &&
    Number.isFinite(savedTtsStreamingInterval)
) {
    state.selectedTtsStreamingInterval = normalizeTtsStreamingInterval(savedTtsStreamingInterval);
    state.ttsStreamingIntervalDirty = true;
}

if (!voiceAgentConfigStatus.asrLoaded) {
    const savedAsrLanguage = await WorkerRpc.getPrefValue(ASR_LANGUAGE_PREF_KEY, true);
    if (
        typeof savedAsrLanguage === "string" &&
        ASR_LANGUAGES.some((language) => language.id === savedAsrLanguage)
    ) {
        state.selectedAsrLanguage = savedAsrLanguage as AsrLanguageId;
    }
}

const savedVoiceSpace = await WorkerRpc.getPrefValue(VOICE_SPACE_PREF_KEY, true);
if (
    typeof savedVoiceSpace === "string" &&
    VOICE_SPACES.some((space) => space.id === savedVoiceSpace)
) {
    state.selectedVoiceSpace = savedVoiceSpace as VoiceSpaceId;
}

const savedPermission = await WorkerRpc.getPrefValue(MIC_PERMISSION_PREF_KEY, true);
if (savedPermission === true) {
    appendLog("A previously approved microphone permission was found.");
}

renderSessionState();

navigator.mediaDevices.addEventListener("devicechange", () => {
    void refreshMicrophones().catch((error) => {
        appendLog(
            `Device refresh failed: ${error instanceof Error ? error.message : String(error)}`,
        );
    });
});

window.addEventListener("beforeunload", () => {
    state.destroying = true;
    void stopVoiceSession("Voice Agent window closed.");
});