class SpeechRateProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const opts = options?.processorOptions ?? {};

    this.blocksPerFrame = opts.blocksPerFrame ?? 4;
    this.frameSamples = 128 * this.blocksPerFrame;
    this.frameSec = this.frameSamples / sampleRate;

    this.sumSq = 0;
    this.zc = 0;
    this.prevSample = 0;
    this.blockCount = 0;

    this.defaultNoiseDb = opts.initialNoiseDb ?? -72;
    this.noiseDb = this.defaultNoiseDb;
    this.inSpeech = false;
    this.hangFrames = opts.hangFrames ?? 10;
    this.hang = 0;

    this.env = 0;
    this.meanEnv = 0;
    this.prevEnv = 0;
    this.prevDiff = 0;
    this.lastPeakTime = -1e9;

    this.minPeakGapSec = opts.minPeakGapSec ?? 0.1;
    this.syllablesPerWord = opts.syllablesPerWord ?? 1.5;
    this.attack = opts.attack ?? 0.35;
    this.release = opts.release ?? 0.15;
    this.wallClockSec = 0;

    this.sessionId = 0;
    this.paused = false;
    this.activeUtteranceId = null;
    this.utteranceTotalSec = 0;
    this.utteranceVoicedSec = 0;
    this.utteranceSyllables = 0;

    this.port.onmessage = (event) => {
      this.handleMessage(event.data);
    };
  }

  resetFrameAccumulators() {
    this.sumSq = 0;
    this.zc = 0;
    this.blockCount = 0;
  }

  resetUtteranceState() {
    this.activeUtteranceId = null;
    this.utteranceTotalSec = 0;
    this.utteranceVoicedSec = 0;
    this.utteranceSyllables = 0;
    this.lastPeakTime = -1e9;
    this.prevDiff = 0;
    this.prevEnv = this.env;
  }

  resetSession(sessionId) {
    this.sessionId = typeof sessionId === "number" ? sessionId : this.sessionId + 1;
    this.paused = false;
    this.resetUtteranceState();
    this.noiseDb = this.defaultNoiseDb;
    this.inSpeech = false;
    this.hang = 0;
    this.env = 0;
    this.meanEnv = 0;
    this.prevEnv = 0;
    this.prevDiff = 0;
    this.wallClockSec = 0;
  }

  handleMessage(message) {
    if (!message || typeof message !== "object") {
      return;
    }

    if (message.type === "reset-session") {
      this.resetSession(message.sessionId);
      return;
    }

    if (typeof message.sessionId === "number" && message.sessionId !== this.sessionId) {
      return;
    }

    if (message.type === "config") {
      if (typeof message.minPeakGapSec === "number" && message.minPeakGapSec > 0) {
        this.minPeakGapSec = message.minPeakGapSec;
      }
      if (typeof message.syllablesPerWord === "number" && message.syllablesPerWord > 0) {
        this.syllablesPerWord = message.syllablesPerWord;
      }
      return;
    }

    if (message.type === "set-paused") {
      this.paused = Boolean(message.paused);
      if (this.paused) {
        this.resetUtteranceState();
        this.inSpeech = false;
        this.hang = 0;
      }
      return;
    }

    if (message.type === "start-utterance") {
      if (typeof message.utteranceId !== "number") {
        return;
      }
      this.resetUtteranceState();
      this.activeUtteranceId = message.utteranceId;
      return;
    }

    if (message.type === "discard-utterance") {
      if (
        typeof message.utteranceId === "number" &&
        this.activeUtteranceId !== message.utteranceId
      ) {
        return;
      }
      this.resetUtteranceState();
      return;
    }

    if (message.type === "finalize-utterance") {
      if (
        typeof message.utteranceId !== "number" ||
        this.activeUtteranceId !== message.utteranceId
      ) {
        return;
      }

      const totalVoicedSec = this.utteranceVoicedSec;
      const totalSec = this.utteranceTotalSec;
      const speechRateSps = this.utteranceSyllables / Math.max(totalVoicedSec, 1e-3);
      const voicedRatio = totalVoicedSec / Math.max(totalSec, 1e-3);
      const estWpm = (speechRateSps * 60) / this.syllablesPerWord;

      this.port.postMessage({
        type: "utterance-summary",
        sessionId: this.sessionId,
        utteranceId: message.utteranceId,
        totalSyllables: this.utteranceSyllables,
        totalVoicedSec,
        totalSec,
        speechRateSps,
        estWpm,
        voicedRatio,
        minPeakGapSec: this.minPeakGapSec,
        syllablesPerWord: this.syllablesPerWord,
        noiseDb: this.noiseDb,
      });

      this.resetUtteranceState();
    }
  }

  finalizeFrame() {
    const eps = 1e-12;
    const rms = Math.sqrt(this.sumSq / this.frameSamples);
    const db = 20 * Math.log10(rms + eps);
    const zcr = this.zc / this.frameSamples;

    if (this.paused) {
      this.inSpeech = false;
      this.hang = 0;
      this.env += 0.05 * (0 - this.env);
      this.meanEnv += 0.05 * (this.env - this.meanEnv);
      this.prevDiff = 0;
      this.prevEnv = this.env;
      this.wallClockSec += this.frameSec;
      this.resetFrameAccumulators();
      return;
    }

    const speechLike = zcr > 0.01 && zcr < 0.3;
    const enterDb = Math.max(this.noiseDb + 10, -52);
    const exitDb = Math.max(this.noiseDb + 6, -56);

    if (!this.inSpeech) {
      if (db > enterDb && speechLike) {
        this.inSpeech = true;
        this.hang = this.hangFrames;
      } else {
        this.noiseDb += 0.03 * (db - this.noiseDb);
      }
    } else if (db > exitDb && speechLike) {
      this.hang = this.hangFrames;
    } else {
      this.hang -= 1;
      if (this.hang <= 0) {
        this.inSpeech = false;
      }
    }

    const alpha = rms > this.env ? this.attack : this.release;
    this.env += alpha * (rms - this.env);

    if (this.inSpeech) {
      this.meanEnv += 0.03 * (this.env - this.meanEnv);
    } else {
      this.meanEnv += 0.01 * (this.env - this.meanEnv);
    }

    const diff = this.env - this.prevEnv;

    if (this.activeUtteranceId !== null) {
      this.utteranceTotalSec += this.frameSec;

      if (this.inSpeech) {
        this.utteranceVoicedSec += this.frameSec;

        const peakThreshold = Math.max(this.meanEnv * 1.12, 0.006);
        const now = this.wallClockSec + this.frameSec;

        if (
          this.prevDiff > 0 &&
          diff <= 0 &&
          this.prevEnv > peakThreshold &&
          now - this.lastPeakTime >= this.minPeakGapSec
        ) {
          this.lastPeakTime = now;
          this.utteranceSyllables += 1;
        }
      }
    }

    this.prevDiff = this.inSpeech ? diff : 0;
    this.prevEnv = this.env;
    this.wallClockSec += this.frameSec;
    this.resetFrameAccumulators();
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }

    const channel = input[0];
    if (!channel || channel.length === 0) {
      return true;
    }

    let prev = this.prevSample;
    for (let index = 0; index < channel.length; index += 1) {
      const sample = channel[index];
      this.sumSq += sample * sample;
      if ((sample >= 0) !== (prev >= 0)) {
        this.zc += 1;
      }
      prev = sample;
    }

    this.prevSample = prev;
    this.blockCount += 1;

    if (this.blockCount >= this.blocksPerFrame) {
      this.finalizeFrame();
    }

    return true;
  }
}

registerProcessor("speech-rate-processor", SpeechRateProcessor);