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
import { createVoiceDetector, VOICE_DETECTOR_DEFAULTS } from "defuss-vad";
import type { VoiceDetector } from "defuss-vad";

const TARGET_SAMPLE_RATE = 16000;
const HOP_SIZE = 256;
const PRE_ROLL_FRAMES = 10;
const HANGOVER_FRAMES = 12;
const VOICE_ACTIVITY_STREAM_DELAY_MS = 500;
const VOICE_ACTIVITY_STREAM_DELAY_FRAMES = Math.ceil(
    ((VOICE_ACTIVITY_STREAM_DELAY_MS / 1000) * TARGET_SAMPLE_RATE) / HOP_SIZE,
);
const MAX_LOG_LINES = 120;
const MAX_OVERLAY_MESSAGES = 8;
const STREAMING_PLACEHOLDER = "Listening...";
const OVERLAY_MARKDOWN_PARSER_OPTIONS = Object.freeze({
    gfm: true,
    math: true,
    htmlTree: true,
    containers: true,
});

const HEALTH_URL = "http://localhost:31337/health";
const ASR_URL = "ws://localhost:31337/asr";

const DEVICE_PREF_KEY = "__aidana_voice_agent_input_device";
const MIC_PERMISSION_PREF_KEY = "__aidana_voice_agent_mic_permission";
const AVATAR_PREF_KEY = "__aidana_voice_agent_avatar";

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

type VoiceDetectionResult = {
    isVoiceStable: boolean;
    rms: number;
    onVoiceStart?: boolean;
    onVoiceEnd?: boolean;
};

type AgentState = {
    head: any | null;
    avatarReady: boolean;
    currentAvatarId: string;
    loadedAvatarId: string | null;
    microphones: MicrophoneOption[];
    selectedDeviceId: string | null;
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
    currentLevel: number;
    destroying: boolean;
};

const state: AgentState = {
    head: null,
    avatarReady: false,
    currentAvatarId: AVATARS[0].id,
    loadedAvatarId: null,
    microphones: [],
    selectedDeviceId: null,
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
    currentLevel: 0,
    destroying: false,
};

let mouthMesh: any = null;
let mouthTargets: Record<string, number> = {};
let targetMouthValue = 0;
let currentMouthValue = 0;
let animationLoopStarted = false;
let overlayMarkdownDisabled = false;

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

function scrollOverlayToLatest() {
    const scrollHost = document.getElementById("voice-overlay-scroll") as HTMLDivElement | null;
    if (!scrollHost) {
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
                        <div
                            class="voice-overlay-markdown"
                            data-overlay-msg-id={message.id}
                        >
                            {message.content}
                        </div>
                        <div class="voice-overlay-meta">
                            <span>{message.role === "user" ? "You" : "Aidana"}</span>
                            <span>
                                {new Date(message.createdAt).toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                })}
                            </span>
                            {message.streaming ? <span>Live</span> : null}
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

function ensureStreamingUserOverlay() {
    if (state.streamingUserMessageId) {
        return;
    }

    const message: OverlayMessage = {
        id: createOverlayMessageId(),
        role: "user",
        content: STREAMING_PLACEHOLDER,
        createdAt: Date.now(),
        streaming: true,
    };

    state.streamingUserMessageId = message.id;
    state.overlayMessages = [...state.overlayMessages, message];
    trimOverlayMessages();
    renderOverlayMessages();
}

function syncStreamingUserOverlay() {
    const nextText = currentStreamingUtteranceText() || STREAMING_PLACEHOLDER;
    ensureStreamingUserOverlay();

    const message = state.overlayMessages.find(
        (item) => item.id === state.streamingUserMessageId,
    );
    if (!message) {
        return;
    }

    message.content = nextText;
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
            state.overlayMessages = state.overlayMessages.filter(
                (item) => item.id !== message.id,
            );
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
    q("voice-inline-status").textContent = state.sessionActive
        ? "The dedicated window is listening locally and will keep running while this window stays open."
        : state.preparingSession
            ? "Waiting for microphone access and validating the local Aidana ASR runtime."
            : "Activate the session to grant microphone access and start local ASR streaming.";

    setPill(
        "session-pill",
        state.sessionActive ? "Listening" : state.preparingSession ? "Preparing" : "Idle",
        state.sessionActive ? "active" : state.preparingSession ? "warn" : "idle",
    );

    setPill(
        "vad-pill",
        state.utteranceActive
            ? "Speech detected"
            : state.awaitingFinal
                ? "Finalizing"
                : "Silence",
        state.utteranceActive ? "active" : state.awaitingFinal ? "warn" : "idle",
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
    syncAvatarSelect();
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

function flushQueuedSocketPayloads() {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
        return;
    }

    while (state.websocketQueue.length > 0) {
        const payload = state.websocketQueue.shift();
        if (payload == null) {
            continue;
        }
        state.socket.send(payload);
    }
}

function closeAsrSocket(closeCode = 1000, reason = "Session idle") {
    const socket = state.socket;
    state.socket = null;
    state.websocketQueue = [];
    resetVoiceActivityGate();
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

    if (state.socket?.readyState === WebSocket.OPEN) {
        state.socket.send(payload);
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

    if (data.done) {
        const finalText = data.text.trim();
        if (finalText) {
            state.transcriptHistory = [finalText, ...state.transcriptHistory].slice(0, 10);
            appendLog(`Final transcript: ${finalText}`);
        } else {
            appendLog("Aidana returned an empty final transcript.");
        }

        finalizeStreamingUserOverlay(finalText);

        state.confirmedTranscript = "";
        state.volatileTranscript = "";
        state.awaitingFinal = false;
        state.socketState = "idle";
        updateTranscriptPanels();
        closeAsrSocket(1000, "Utterance complete");
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

    syncStreamingUserOverlay();
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

    socket.onopen = () => {
        if (state.socket !== socket) {
            socket.close(1000, "Superseded");
            return;
        }

        state.socketState = state.awaitingFinal ? "waiting" : "streaming";
        flushQueuedSocketPayloads();
        renderSessionState();
        appendLog("Aidana ASR websocket is open.");
    };

    socket.onmessage = (event) => {
        void handleAsrMessage(event.data);
    };

    socket.onerror = () => {
        if (state.socket !== socket) {
            return;
        }

        finalizeStreamingUserOverlay(currentStreamingUtteranceText());
        state.asrHealthy = false;
        state.socketState = "error";
        state.utteranceActive = false;
        state.awaitingFinal = false;
        state.websocketQueue = [];
        renderSessionState();
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

        state.socket = null;
        state.websocketQueue = [];
        state.utteranceActive = false;
        state.awaitingFinal = false;
        state.hangoverFramesRemaining = 0;
        state.socketState = state.sessionActive ? "idle" : "error";
        finalizeStreamingUserOverlay(currentStreamingUtteranceText());
        renderSessionState();

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

function beginUtterance(bufferedFrames: Float32Array[] = state.prerollFrames) {
    if (!state.sessionActive || state.utteranceActive || state.awaitingFinal) {
        return;
    }

    ensureStreamingUserOverlay();
    state.utteranceActive = true;
    state.awaitingFinal = false;
    state.hangoverFramesRemaining = HANGOVER_FRAMES;
    state.socketState = "connecting";
    state.websocketQueue = bufferedFrames.map((frame) => frame.slice().buffer);
    resetVoiceActivityGate();
    renderSessionState();
    appendLog(
        `Voice stayed active for ${VOICE_ACTIVITY_STREAM_DELAY_MS}ms. Opening utterance stream.`,
    );
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

    if (state.socket?.readyState === WebSocket.OPEN) {
        state.socket.send(JSON.stringify({ flush: true }));
    } else {
        state.websocketQueue.push(JSON.stringify({ flush: true }));
    }

    renderSessionState();
    appendLog("Voice end detected. Flushing utterance to Aidana ASR.");
}

function maybeStartUtterance(frame: Float32Array, result: VoiceDetectionResult) {
    if (!state.sessionActive || state.utteranceActive || state.awaitingFinal) {
        return false;
    }

    if (!result.isVoiceStable) {
        if (state.stableVoiceFrames > 0) {
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

    beginUtterance(state.pendingVoiceFrames);
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
    currentMouthValue += (targetMouthValue - currentMouthValue) * 0.35;
    if (currentMouthValue < 0.005) {
        currentMouthValue = 0;
    }

    applyMouthMorph(currentMouthValue);
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

function resetAvatarStage() {
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
        lipsyncLang: "en",
        lipsyncModules: [],
        modelFPS: 60,
        cameraRotateX: 0.1,
        postureChangePerSec: 0,
        bodyMoveFactor: 0,
    });

    await head.showAvatar(
        {
            url: avatar.url,
            body: avatar.body,
            avatarMood: "neutral",
            lipsyncLang: "en",
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
}

async function teardownAudioSession() {
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

        state.detector = await createVoiceDetector();
        appendLog(
            `VoiceDetector ready (threshold ${VOICE_DETECTOR_DEFAULTS.threshold}, RMS floor ${VOICE_DETECTOR_DEFAULTS.rmsFloor}).`,
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

        const microphoneName = activeMicrophoneLabel() ?? "the selected microphone";
        setStatus(
            "Listening",
            `Aidana is capturing ${microphoneName} with echo cancellation and will stream only VAD-detected utterances to the local ASR service.`,
        );
        appendLog(
            `Voice session started (${nativeRate} Hz input -> ${TARGET_SAMPLE_RATE} Hz ASR) using ${microphoneName}.`,
        );
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
                        <div class="voice-avatar-picker">
                            <Label htmlFor="avatar-select">Avatar</Label>
                            <select id="avatar-select" class="voice-device-select voice-avatar-select">
                                {AVATARS.map((avatar) => (
                                    <option value={avatar.id}>{avatar.label}</option>
                                ))}
                            </select>
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
                            <div id="voice-overlay-left" class="voice-overlay-lane voice-overlay-lane-left" />
                            <div class="voice-overlay-lane voice-overlay-lane-right">
                                <div id="voice-overlay-scroll" class="voice-overlay-scroll">
                                    <div id="voice-overlay-stream" class="voice-overlay-stream" />
                                </div>
                            </div>
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

updateTranscriptPanels();
renderOverlayMessages();
updateLevelIndicator();
renderSessionState();

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