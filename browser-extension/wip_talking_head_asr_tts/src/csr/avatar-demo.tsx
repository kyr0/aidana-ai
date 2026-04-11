import { $ } from "defuss";
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
} from "defuss-shadcn";
import { TalkingHead } from "@met4citizen/talkinghead";
import { LipsyncEn } from "@met4citizen/talkinghead/modules/lipsync-en.mjs";
import { createVAD, createVoiceDetector, resampleLinear, VOICE_DETECTOR_DEFAULTS } from "defuss-vad";
import type { VAD, VADResult, VoiceDetector } from "defuss-vad";

const CDN_BASE = "https://cdn.jsdelivr.net/gh/met4citizen/HeadTTS@main/avatars";
const AUDIO_URL = "/reference.wav";

const AVATARS = [
	{ id: "julia", label: "Julia (Female)", url: `${CDN_BASE}/julia.glb`, body: "F" as const },
	{ id: "david", label: "David (Male)", url: `${CDN_BASE}/david.glb`, body: "M" as const },
] as const;

type VoiceSegment = { startMs: number; endMs: number };

type DemoState = {
	head: any | null;
	audioBuffer: AudioBuffer | null;
	initialized: boolean;
	currentAvatar: string;
	vad: VAD | null;
	detector: VoiceDetector | null;
	voiceSegments: VoiceSegment[];
};

const state: DemoState = {
	head: null,
	audioBuffer: null,
	initialized: false,
	currentAvatar: "",
	vad: null,
	detector: null,
	voiceSegments: [],
};

// ── Self-Test (microphone) state ──────────────────────────────────────────────

type MicState = {
	stream: MediaStream | null;
	audioCtx: AudioContext | null;
	processor: ScriptProcessorNode | null;
	source: MediaStreamAudioSourceNode | null;
	active: boolean;
};

const mic: MicState = {
	stream: null,
	audioCtx: null,
	processor: null,
	source: null,
	active: false,
};

// Mouth morph-target animation
let mouthMesh: any = null;
let mouthTargets: Record<string, number> = {};
let targetMouthValue = 0;
let currentMouthValue = 0;
const MOUTH_LERP = 0.35;

function getSelectedAvatar() {
	const id = q<HTMLSelectElement>("demo-avatar").value;
	return AVATARS.find((a) => a.id === id) ?? AVATARS[0];
}

function q<T extends HTMLElement>(id: string): T {
	const node = document.getElementById(id);
	if (!node) {
		throw new Error(`Missing DOM node #${id}`);
	}
	return node as T;
}

function logLine(line: string) {
	const log = q<HTMLPreElement>("demo-log");
	const timestamp = new Date().toLocaleTimeString();
	const next = `${timestamp}  ${line}`;
	log.textContent = log.textContent ? `${next}\n${log.textContent}` : next;
}

function setStatus(title: string, description: string, variant: "default" | "destructive" | "warning" = "default") {
	$(q("demo-status")).update(
		<Alert variant={variant !== "default" ? variant : undefined}>
			<AlertTitle>{title}</AlertTitle>
			<AlertDescription>{description}</AlertDescription>
		</Alert>,
	);
}

async function ensureReady() {
	const avatar = getSelectedAvatar();

	// Re-init if avatar selection changed
	if (state.initialized && state.currentAvatar !== avatar.id) {
		state.initialized = false;
		state.head = null;
		q("avatar-stage").innerHTML = "";
		setStatus("Switching avatar…", `Loading ${avatar.label}. Please wait.`, "warning");
		logLine(`Switching avatar to ${avatar.label}…`);
	}

	if (state.initialized && state.head && state.audioBuffer) return;

	setStatus("Initializing\u2026", `Loading ${avatar.label} and decoding the reference audio.`);
	logLine(`Creating TalkingHead with ${avatar.label}.`);

	const head = new TalkingHead(q("avatar-stage"), {
		cameraView: "upper",
		avatarMood: "neutral",
		lipsyncLang: "en",
		lipsyncModules: [],
		modelFPS: 60,
		cameraRotateX: 0.1,
		postureChangePerSec: 0,
		bodyMoveFactor: 0,
	});

	// Monkey-patch the English lipsync module (avoids Vite dynamic import issue)
	head.lipsync["en"] = new LipsyncEn();
	logLine("English lipsync module injected.");

	await head.showAvatar(
		{
			url: avatar.url,
			body: avatar.body,
			avatarMood: "neutral",
			lipsyncLang: "en",
			ttsLang: "en-US",
			ttsVoice: avatar.body === "M" ? "en-US-Standard-D" : "en-US-Standard-F",
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
			logLine("Avatar asset loaded.");
		},
	);

	logLine("Fetching reference audio\u2026");
	const response = await fetch(AUDIO_URL);
	if (!response.ok) throw new Error(`Failed to fetch ${AUDIO_URL}: ${response.status}`);
	const arrayBuffer = await response.arrayBuffer();
	const audioCtx = new AudioContext();
	const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
	await audioCtx.close();
	logLine(`Audio decoded: ${audioBuffer.duration.toFixed(2)}s, ${audioBuffer.sampleRate}Hz.`);

	state.head = head;
	state.audioBuffer = audioBuffer;
	state.initialized = true;
	state.currentAvatar = avatar.id;

	setStatus("Ready", `${avatar.label} loaded. Press \u201cSpeak\u201d to play back the reference audio with lip-sync.`);
}

/** Run VAD analysis on the loaded reference audio. */
async function runVADAnalysis() {
	if (!state.audioBuffer) {
		logLine("No audio loaded — initialize first.");
		return;
	}

	setStatus("Running VAD\u2026", "Analysing reference audio with defuss-vad (WASM).");
	logLine("Initializing defuss-vad WASM module\u2026");

	if (!state.vad) {
		state.vad = await createVAD({ hopSize: 256, threshold: 0.5 });
		logLine(`VAD created. Version: ${state.vad.getVersion()}`);
	}

	// Convert AudioBuffer to 16kHz mono Int16 for VAD
	const audioBuffer = state.audioBuffer;
	const channelData = audioBuffer.getChannelData(0); // Float32 [-1, 1]
	const sampleRate = audioBuffer.sampleRate;

	// Convert Float32 -> Int16
	const int16 = new Int16Array(channelData.length);
	for (let i = 0; i < channelData.length; i++) {
		const s = Math.max(-1, Math.min(1, channelData[i]!));
		int16[i] = s < 0 ? s * 32768 : s * 32767;
	}

	// Resample to 16kHz if necessary
	const samples = sampleRate !== 16000 ? resampleLinear(int16, sampleRate, 16000) : int16;
	logLine(`VAD input: ${samples.length} samples at 16kHz (${(samples.length / 16000).toFixed(2)}s).`);

	const hopSize = 256;
	const frameCount = Math.floor(samples.length / hopSize);
	const frameDurationMs = (hopSize / 16000) * 1000; // 16ms per frame

	let voiceFrames = 0;
	const segments: VoiceSegment[] = [];
	let segStart = -1;

	for (let i = 0; i < frameCount; i++) {
		const frame = samples.slice(i * hopSize, (i + 1) * hopSize);
		const result: VADResult = state.vad.process(frame);

		if (result.isVoice) {
			voiceFrames++;
			if (segStart < 0) segStart = i;
		} else {
			if (segStart >= 0) {
				segments.push({
					startMs: segStart * frameDurationMs,
					endMs: i * frameDurationMs,
				});
				segStart = -1;
			}
		}
	}
	// Close trailing segment
	if (segStart >= 0) {
		segments.push({
			startMs: segStart * frameDurationMs,
			endMs: frameCount * frameDurationMs,
		});
	}

	state.voiceSegments = segments;

	const voicePct = ((voiceFrames / frameCount) * 100).toFixed(1);
	logLine(`VAD complete: ${voiceFrames}/${frameCount} voice frames (${voicePct}%).`);
	logLine(`Detected ${segments.length} voice segment(s):`);
	for (const seg of segments) {
		logLine(`  ${(seg.startMs / 1000).toFixed(2)}s \u2013 ${(seg.endMs / 1000).toFixed(2)}s  (${(seg.endMs - seg.startMs).toFixed(0)}ms)`);
	}

	setStatus(
		"VAD complete",
		`${segments.length} voice segment(s) found, ${voicePct}% voice. Press \u201cSpeak\u201d to play with VAD-guided lip-sync.`,
	);
}

// ── Mouth morph-target helpers ────────────────────────────────────────────────

/** Walk the Three.js scene graph to find the SkinnedMesh with face blend shapes. */
function findMouthMesh(head: any) {
	if (mouthMesh) return;
	const root = head.avatar ?? head.model;
	if (!root?.traverse) return;
	root.traverse((obj: any) => {
		if (mouthMesh) return;
		if (obj.morphTargetDictionary && obj.morphTargetInfluences) {
			if ("jawOpen" in obj.morphTargetDictionary || "mouthOpen" in obj.morphTargetDictionary) {
				mouthMesh = obj;
				mouthTargets = obj.morphTargetDictionary;
			}
		}
	});
}

/** Apply a [0..1] openness value to jaw / mouth morph targets. */
function applyMouthMorph(value: number) {
	if (!mouthMesh) return;
	const jawIdx = mouthTargets["jawOpen"];
	if (jawIdx !== undefined) mouthMesh.morphTargetInfluences[jawIdx] = value * 0.7;
	const mouthIdx = mouthTargets["mouthOpen"];
	if (mouthIdx !== undefined) mouthMesh.morphTargetInfluences[mouthIdx] = value * 0.4;
}

/** rAF loop that smoothly interpolates mouth openness while self-test is active. */
function mouthAnimationLoop() {
	if (!mic.active) {
		currentMouthValue = 0;
		applyMouthMorph(0);
		return;
	}
	currentMouthValue += (targetMouthValue - currentMouthValue) * MOUTH_LERP;
	if (currentMouthValue < 0.005) currentMouthValue = 0;
	applyMouthMorph(currentMouthValue);
	requestAnimationFrame(mouthAnimationLoop);
}

// ── Self-Test: mic → VAD → mouth ─────────────────────────────────────────────

async function startSelfTest() {
	await ensureReady();

	// Ensure a fresh VoiceDetector for real-time streaming
	if (state.detector) { state.detector.destroy(); state.detector = null; }
	state.detector = await createVoiceDetector();
	logLine(`VoiceDetector ready (v${state.detector.getVersion()}, threshold ${VOICE_DETECTOR_DEFAULTS.threshold}, RMS floor ${VOICE_DETECTOR_DEFAULTS.rmsFloor}).`);

	findMouthMesh(state.head);
	if (!mouthMesh) logLine("⚠ Could not locate face morph targets — mouth animation may not work.");

	// Request mic
	const stream = await navigator.mediaDevices.getUserMedia({
		audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
	});

	const audioCtx = new AudioContext();
	const nativeRate = audioCtx.sampleRate;
	const source = audioCtx.createMediaStreamSource(stream);

	// ScriptProcessorNode: 4096 samples per callback at native rate
	const processor = audioCtx.createScriptProcessor(4096, 1, 1);

	// Mute output to avoid feedback (processor still needs a destination)
	const muteNode = audioCtx.createGain();
	muteNode.gain.value = 0;
	source.connect(processor);
	processor.connect(muteNode);
	muteNode.connect(audioCtx.destination);

	const hopSize = 256;
	const ratio = nativeRate / 16000;
	let residual = new Float32Array(0);

	processor.onaudioprocess = (event) => {
		if (!mic.active || !state.detector) return;

		const input = event.inputBuffer.getChannelData(0);

		// Concatenate with leftover from previous callback
		const combined = new Float32Array(residual.length + input.length);
		combined.set(residual);
		combined.set(input, residual.length);

		let offset = 0;
		const samplesNeeded = Math.ceil(hopSize * ratio);

		while (offset + samplesNeeded <= combined.length) {
			// Resample chunk → 16 kHz Int16
			const int16 = new Int16Array(hopSize);
			for (let i = 0; i < hopSize; i++) {
				const srcIdx = offset + i * ratio;
				const lo = Math.floor(srcIdx);
				const hi = Math.min(lo + 1, combined.length - 1);
				const frac = srcIdx - lo;
				const sample = combined[lo]! * (1 - frac) + combined[hi]! * frac;
				int16[i] = Math.max(-32768, Math.min(32767, Math.round(sample * 32768)));
			}
			offset += samplesNeeded;

			const result = state.detector.process(int16);

			targetMouthValue = result.isVoiceStable ? Math.min(1, result.rms * 6) : 0;

			if (result.onVoiceStart) logLine("🟢 Voice START");
			if (result.onVoiceEnd) logLine("🔴 Voice END");
		}

		residual = combined.slice(offset);
	};

	mic.stream = stream;
	mic.audioCtx = audioCtx;
	mic.processor = processor;
	mic.source = source;
	mic.active = true;

	requestAnimationFrame(mouthAnimationLoop);

	logLine(`Self-Test started (mic ${nativeRate} Hz → VAD 16 kHz, hop ${hopSize}).`);
	setStatus("Self-Test", "Speak into the microphone — the avatar's mouth follows your voice via defuss-vad.");
}

function stopSelfTest() {
	if (!mic.active) return;
	mic.active = false;
	targetMouthValue = 0;

	try { mic.processor?.disconnect(); } catch (_) { /* ignore */ }
	try { mic.source?.disconnect(); } catch (_) { /* ignore */ }
	try { mic.audioCtx?.close(); } catch (_) { /* ignore */ }
	if (mic.stream) {
		for (const track of mic.stream.getTracks()) track.stop();
	}

	mic.processor = null;
	mic.source = null;
	mic.audioCtx = null;
	mic.stream = null;

	if (state.detector) { state.detector.destroy(); state.detector = null; }

	applyMouthMorph(0);
	logLine("Self-Test stopped.");
}

// ── Button handlers ──────────────────────────────────────────────────────────

async function handleInit() {
	try {
		await ensureReady();
	} catch (error) {
		console.error(error);
		setStatus("Initialization failed", String(error), "destructive");
		logLine(`Initialization failed: ${String(error)}`);
	}
}

async function handleVAD() {
	try {
		await ensureReady();
		await runVADAnalysis();
	} catch (error) {
		console.error(error);
		setStatus("VAD failed", String(error), "destructive");
		logLine(`VAD failed: ${String(error)}`);
	}
}

async function handleSelfTest() {
	try {
		if (mic.active) {
			stopSelfTest();
			setStatus("Stopped", "Self-Test stopped.");
			return;
		}
		await startSelfTest();
	} catch (error) {
		console.error(error);
		setStatus("Self-Test failed", String(error), "destructive");
		logLine(`Self-Test failed: ${String(error)}`);
	}
}

async function handleSpeak() {
	try {
		await ensureReady();

		const head = state.head!;
		const audioBuffer = state.audioBuffer!;

		logLine("Playing reference audio with lip-sync\u2026");
		setStatus("Speaking\u2026", "Playing reference.wav through TalkingHead with word-level lip-sync.");

		const durationMs = audioBuffer.duration * 1000;
		const sampleWords = "Hello from defuss this is a talking head avatar demo with reference audio playback".split(" ");

		let wtimes: number[];
		let wdurations: number[];

		if (state.voiceSegments.length > 0) {
			// Use VAD-detected voice segments: distribute words across voiced regions
			const totalVoiceMs = state.voiceSegments.reduce((sum, s) => sum + (s.endMs - s.startMs), 0);
			const msPerWord = totalVoiceMs / sampleWords.length;
			wtimes = [];
			wdurations = [];

			let wordIdx = 0;
			for (const seg of state.voiceSegments) {
				const segDur = seg.endMs - seg.startMs;
				const wordsInSeg = Math.max(1, Math.round(segDur / msPerWord));
				const wordDur = segDur / wordsInSeg;
				for (let w = 0; w < wordsInSeg && wordIdx < sampleWords.length; w++, wordIdx++) {
					wtimes.push(seg.startMs + w * wordDur);
					wdurations.push(wordDur);
				}
			}
			// Assign remaining words to the last segment
			while (wordIdx < sampleWords.length) {
				const last = state.voiceSegments[state.voiceSegments.length - 1]!;
				wtimes.push(last.endMs);
				wdurations.push(0);
				wordIdx++;
			}

			logLine(`Lip-sync: words mapped to ${state.voiceSegments.length} VAD segment(s).`);
		} else {
			// Fallback: spread words evenly across the full audio duration
			const wordDuration = durationMs / sampleWords.length;
			wtimes = sampleWords.map((_, i) => i * wordDuration);
			wdurations = sampleWords.map(() => wordDuration);
			logLine("Lip-sync: even spread (no VAD data \u2014 run VAD first for better timing).");
		}

		head.speakAudio(
			{
				audio: audioBuffer,
				words: sampleWords,
				wtimes,
				wdurations,
			},
			{ lipsyncLang: "en" },
		);

		logLine("speakAudio() called. Avatar is speaking.");
		setStatus("Speaking\u2026", `Playing ${audioBuffer.duration.toFixed(1)}s of audio.`);
	} catch (error) {
		console.error(error);
		setStatus("Speak failed", String(error), "destructive");
		logLine(`Speak failed: ${String(error)}`);
	}
}

function handleStop() {
	stopSelfTest();
	try {
		state.head?.stopSpeaking?.();
	} catch (error) {
		console.warn(error);
	}
	setStatus("Stopped", "Playback stopped.");
	logLine("Playback stopped.");
}

function handleResetLog() {
	q<HTMLPreElement>("demo-log").textContent = "";
}

export function AvatarDemoScreen() {
	return (
		<main class="demo-shell">
			<Card class="demo-card">
				<CardHeader>
					<div class="flex items-center justify-between gap-3">
						<div>
							<CardTitle className="text-lg mb-2 font-bold">TalkingHead</CardTitle>
							<CardDescription>
								three.js + defuss-vad (WASM). <strong>Offline:</strong> analyse a WAV then play with VAD-guided lip-sync. <strong>Self-Test:</strong> speak into your mic — the mouth follows in real-time.
							</CardDescription>
						</div>
					</div>
				</CardHeader>
				<CardContent class="control-grid">
					<div id="demo-status">
						<Alert class="mt-4 border p-2 rounded-md	bg-yellow-50 text-yellow-800">
							<AlertTitle>Not initialized</AlertTitle>
							<AlertDescription class="text-sm">
								Click "Initialize" to load the 3D avatar and decode the reference audio.
							</AlertDescription>
						</Alert>
					</div>

					<div class="field-grid">
						<Label for="demo-avatar">Avatar</Label>
						<select id="demo-avatar" class="demo-select">
							{AVATARS.map((a) => (
								<option key={a.id} value={a.id}>{a.label}</option>
							))}
						</select>
					</div>

					<div class="field-grid">
						<Label>Offline Test</Label>
						<div class="button-row">
							<Button onClick={handleInit}>Initialize</Button>
							<Button onClick={handleVAD}>Run VAD</Button>
							<Button onClick={handleSpeak}>Speak</Button>
						</div>
					</div>

					<div class="field-grid">
						<Label>Self-Test (Microphone)</Label>
						<div class="button-row">
							<Button onClick={handleSelfTest}>Self-Test</Button>
							<Button variant="secondary" onClick={handleStop}>
								Stop
							</Button>
							<Button variant="secondary" onClick={handleResetLog}>
								Clear log
							</Button>
						</div>
					</div>

					<div class="field-grid">
						<Label>Log</Label>
						<pre id="demo-log" class="demo-log" />
					</div>
				</CardContent>
			</Card>

			<Card class="demo-card">
				<CardContent>
					<div id="avatar-stage" class="avatar-stage" />
				</CardContent>
			</Card>
		</main>
	);
}
