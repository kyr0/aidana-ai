//
//  AIServer.swift
//  Aidana
//

import FluidAudio
import Foundation
import Hummingbird
import HummingbirdWebSocket
import NIOCore
import os

actor AIServer {
    private let logger = Logger(subsystem: "de.aronhomberg.aidana", category: "AIServer")
    let modelManager = ModelManager()
    private var serverTask: Task<Void, any Error>?
    private(set) var isRunning = false
    var onLog: (@Sendable (String) -> Void)?
    var onModeChange: (@Sendable (String) -> Void)?   // "idle" or "active"
    var wakeWordProvider: (@Sendable () -> String)?    // returns current wake word

    func setLogCallback(_ callback: @escaping @Sendable (String) -> Void) {
        onLog = callback
    }

    func setModeChangeCallback(_ callback: @escaping @Sendable (String) -> Void) {
        onModeChange = callback
    }

    func setWakeWordProvider(_ provider: @escaping @Sendable () -> String) {
        wakeWordProvider = provider
    }

    func start(port: Int) async throws {
        guard !isRunning else {
            logger.warning("Server already running")
            return
        }

        logger.info("Starting AI server on port \(port)")

        let modelMgr = self.modelManager
        let logFn = self.onLog
        let modeChangeFn = self.onModeChange
        let wakeWordFn = self.wakeWordProvider

        // HTTP router for health/status endpoints
        let router = Router()

        router.get("/health") { _, _ -> Response in
            let asrReady = await modelMgr.asrReady
            let body = """
            {"status":"ok","asr_ready":\(asrReady)}
            """
            return Response(
                status: .ok,
                headers: [.contentType: "application/json"],
                body: .init(byteBuffer: ByteBuffer(string: body))
            )
        }

        router.get("/models") { _, _ -> Response in
            let asrReady = await modelMgr.asrReady
            let body = """
            {"asr":{"model":"parakeet-tdt-0.6b-v3","loaded":\(asrReady)}}
            """
            return Response(
                status: .ok,
                headers: [.contentType: "application/json"],
                body: .init(byteBuffer: ByteBuffer(string: body))
            )
        }

        // WebSocket router
        let wsRouter = Router(context: BasicWebSocketRequestContext.self)

        wsRouter.ws("/asr") { request, _ in
            let asrReady = await modelMgr.asrReady
            guard asrReady else {
                return .dontUpgrade
            }
            return .upgrade([:])
        } onUpgrade: { inbound, outbound, context in
            let reqLogger = Logger(subsystem: "de.aronhomberg.aidana", category: "ASR-WS")

            let sampleRate = Int(ASRWebSocketHandler.sampleRate)
            let partialMinSamples = Int(Double(sampleRate) * 1.0)
            let partialStrideSamples = Int(Double(sampleRate) * 0.75)
            let partialMinInterval: TimeInterval = 0.30
            let autoCommitSamples = Int(Double(sampleRate) * 12.0)
            let overlapSamples = Int(Double(sampleRate) * 2.0)

            var requestedLanguage = "auto"
            var ignoreWakeWord = false
            var consecutiveMode = true
            var pcmPacketsReceived = 0
            var outgoingPackets = 0
            var bufferedSamples: [Float] = []
            var committedTranscript = ""
            var lastRenderedTranscript = ""
            var lastPartialSampleCount = 0
            var lastPartialAt = Date.distantPast

            reqLogger.info("ASR WebSocket connected")
            logFn?("ASR client connected (rolling consecutive cadence)")

            // Listening mode: idle (wake word detection) vs active (sending results)
            var isActive = false
            let currentWakeWord = wakeWordFn?() ?? ""
            if currentWakeWord.isEmpty {
                isActive = true
            }

            func setMode(_ active: Bool) {
                isActive = active
                let mode = active ? "ACTIVE" : "IDLE"
                modeChangeFn?(active ? "active" : "idle")
                logFn?("=== MODE NOW: \(mode) ===")
            }

            func normalizeTranscript(_ text: String) -> String {
                text
                    .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
                    .trimmingCharacters(in: .whitespacesAndNewlines)
            }

            func mergeTranscript(_ base: String, _ addition: String) -> String {
                let normalizedBase = normalizeTranscript(base)
                let normalizedAddition = normalizeTranscript(addition)

                guard !normalizedBase.isEmpty else { return normalizedAddition }
                guard !normalizedAddition.isEmpty else { return normalizedBase }

                if normalizedAddition.hasPrefix(normalizedBase) {
                    return normalizedAddition
                }
                if normalizedBase.hasPrefix(normalizedAddition) {
                    return normalizedBase
                }

                let maxOverlap = min(normalizedBase.count, normalizedAddition.count)
                if maxOverlap > 0 {
                    for candidate in stride(from: maxOverlap, through: 1, by: -1) {
                        let suffixStart = normalizedBase.index(normalizedBase.endIndex, offsetBy: -candidate)
                        let prefixEnd = normalizedAddition.index(normalizedAddition.startIndex, offsetBy: candidate)
                        let baseSuffix = normalizedBase[suffixStart...]
                        let additionPrefix = normalizedAddition[..<prefixEnd]

                        if baseSuffix == additionPrefix {
                            return normalizedBase + normalizedAddition[prefixEnd...]
                        }
                    }
                }

                return normalizedBase + " " + normalizedAddition
            }

            func paddedSamplesForASR(_ samples: [Float]) -> [Float] {
                guard samples.count < partialMinSamples else { return samples }
                return samples + Array(repeating: 0, count: partialMinSamples - samples.count)
            }

            func effectiveWakeWord() -> String {
                if ignoreWakeWord {
                    return ""
                }

                return (wakeWordFn?() ?? "")
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                    .lowercased()
            }

            /// Extract text after the wake word, or nil if wake word not found.
            func extractAfterWakeWord(_ text: String, wakeWord: String) -> String? {
                let words = text.components(separatedBy: .whitespaces).filter { !$0.isEmpty }
                guard let idx = words.firstIndex(where: { $0.lowercased() == wakeWord }) else {
                    return nil
                }
                return words[(idx + 1)...].joined(separator: " ")
            }

            func sendPacket(text: String, confirmed: Bool, done: Bool, updateType: String) async throws {
                let result = ASRWebSocketHandler.ASRResultJSON(
                    text: text, confirmed: confirmed, done: done)
                let json = try ASRWebSocketHandler.encodeResult(result)
                try await outbound.write(.text(json))
                outgoingPackets += 1
                reqLogger.info("Sent ASR packet #\(outgoingPackets) [\(updateType)] \(text)")
            }

            func publishTranscript(_ rawText: String, confirmed: Bool, done: Bool, updateType: String) async throws {
                let normalizedText = normalizeTranscript(rawText)
                let wakeWord = effectiveWakeWord()

                if wakeWord.isEmpty {
                    if !isActive {
                        setMode(true)
                    }

                    guard done || !normalizedText.isEmpty else { return }
                    try await sendPacket(text: normalizedText, confirmed: confirmed, done: done, updateType: updateType)
                    if done {
                        logFn?("ASR: \(normalizedText) [done]")
                    } else {
                        logFn?("ASR \(updateType) [\(requestedLanguage)]: \(normalizedText)")
                    }
                    return
                }

                if !isActive {
                    if let afterWakeWord = extractAfterWakeWord(normalizedText, wakeWord: wakeWord) {
                        setMode(true)
                        logFn?("Wake word '\(wakeWord)' detected, active listening")
                        if done || !afterWakeWord.isEmpty {
                            try await sendPacket(text: afterWakeWord, confirmed: confirmed, done: done, updateType: updateType)
                            if done {
                                logFn?("ASR: \(afterWakeWord) [done]")
                            } else {
                                logFn?("ASR \(updateType) [\(requestedLanguage)]: \(afterWakeWord)")
                            }
                        }
                        return
                    }

                    if !normalizedText.isEmpty {
                        logFn?("IDLE: \(normalizedText)")
                        reqLogger.info("ASR \(updateType) [IDLE] \(normalizedText)")
                    }

                    if done {
                        try await sendPacket(text: "", confirmed: true, done: true, updateType: updateType)
                        logFn?("ASR:  [done]")
                    }
                    return
                }

                let activeText = extractAfterWakeWord(normalizedText, wakeWord: wakeWord) ?? normalizedText
                guard done || !activeText.isEmpty else { return }

                try await sendPacket(text: activeText, confirmed: confirmed, done: done, updateType: updateType)
                if done {
                    logFn?("ASR: \(activeText) [done]")
                } else {
                    logFn?("ASR \(updateType) [\(requestedLanguage)]: \(activeText)")
                }
            }

            func maybeEmitRollingPartial(force: Bool = false) async throws {
                guard consecutiveMode else { return }

                let sampleCount = bufferedSamples.count
                guard sampleCount >= partialMinSamples else { return }

                let now = Date()
                if !force {
                    let enoughNewAudio = sampleCount - lastPartialSampleCount >= partialStrideSamples
                    let enoughTimeElapsed = now.timeIntervalSince(lastPartialAt) >= partialMinInterval
                    guard enoughNewAudio && enoughTimeElapsed else { return }
                }

                let snapshot = bufferedSamples
                lastPartialSampleCount = sampleCount
                lastPartialAt = now
                let inferenceSamples = paddedSamplesForASR(snapshot)

                let result: ASRResult
                do {
                    result = try await modelMgr.transcribe(samples: inferenceSamples)
                } catch {
                    let seconds = Double(sampleCount) / Double(sampleRate)
                    let durationText = String(format: "%.2f", seconds)
                    reqLogger.error(
                        "Rolling partial transcription failed at \(durationText)s: \(error.localizedDescription)"
                    )
                    logFn?("Rolling ASR partial failed at \(durationText)s: \(error.localizedDescription)")
                    return
                }
                let segmentText = normalizeTranscript(result.text)
                guard !segmentText.isEmpty else { return }

                let mergedText = mergeTranscript(committedTranscript, segmentText)
                if mergedText != lastRenderedTranscript {
                    lastRenderedTranscript = mergedText
                    try await publishTranscript(mergedText, confirmed: false, done: false, updateType: "PARTIAL")
                }

                if sampleCount >= autoCommitSamples {
                    committedTranscript = mergeTranscript(committedTranscript, segmentText)
                    lastRenderedTranscript = committedTranscript
                    try await publishTranscript(committedTranscript, confirmed: true, done: false, updateType: "CONFIRMED")

                    let keepCount = min(overlapSamples, bufferedSamples.count)
                    bufferedSamples = keepCount > 0 ? Array(bufferedSamples.suffix(keepCount)) : []
                    lastPartialSampleCount = bufferedSamples.count

                    reqLogger.info(
                        "Auto-committed rolling ASR segment; retained \(keepCount) overlap samples for the next pass"
                    )
                }
            }

            func finalizeRollingSession() async throws {
                if !bufferedSamples.isEmpty {
                    do {
                        let finalSamples = paddedSamplesForASR(bufferedSamples)
                        let result = try await modelMgr.transcribe(samples: finalSamples)
                        let finalSegment = normalizeTranscript(result.text)
                        if !finalSegment.isEmpty {
                            committedTranscript = mergeTranscript(committedTranscript, finalSegment)
                        }
                    } catch {
                        let seconds = Double(bufferedSamples.count) / Double(sampleRate)
                        let durationText = String(format: "%.2f", seconds)
                        reqLogger.error(
                            "Rolling final transcription failed at \(durationText)s: \(error.localizedDescription)"
                        )
                        logFn?("Rolling ASR final failed at \(durationText)s: \(error.localizedDescription)")
                    }
                }

                let finalText = normalizeTranscript(
                    committedTranscript.isEmpty ? lastRenderedTranscript : mergeTranscript(committedTranscript, lastRenderedTranscript)
                )
                lastRenderedTranscript = finalText
                try await publishTranscript(finalText, confirmed: true, done: true, updateType: "DONE")

                if !effectiveWakeWord().isEmpty {
                    setMode(false)
                }
            }

            do {
                for try await message in inbound.messages(maxSize: 1 << 24) {
                    switch message {
                    case .binary(let byteBuffer):
                        let data = Data(buffer: byteBuffer)
                        let samples = ASRWebSocketHandler.decodePCMFrame(data)
                        pcmPacketsReceived += 1
                        if pcmPacketsReceived % 10 == 0 {
                            reqLogger.info(
                                "Received \(pcmPacketsReceived) PCM frames from browser (last frame: \(samples.count) samples)"
                            )
                        }

                        if !samples.isEmpty {
                            bufferedSamples.append(contentsOf: samples)
                            try await maybeEmitRollingPartial()
                        }
                    case .text(let text):
                        if let control = ASRWebSocketHandler.decodeControl(text) {
                            reqLogger.info("Received ASR control frame: \(text)")

                            if let language = control.language?
                                .trimmingCharacters(in: .whitespacesAndNewlines), !language.isEmpty
                            {
                                requestedLanguage = language
                                reqLogger.info("ASR language hint updated to \(requestedLanguage)")
                                logFn?("ASR language hint: \(requestedLanguage)")
                            }

                            if control.ignoreWakeWord == true {
                                ignoreWakeWord = true
                                if !isActive {
                                    setMode(true)
                                }
                                reqLogger.info("Wake word bypass enabled for this ASR session")
                                logFn?("ASR wake word bypass enabled for this session")
                            }

                            if control.consecutive == true {
                                consecutiveMode = true
                                reqLogger.info("Consecutive rolling ASR mode enabled for this ASR session")
                                logFn?("ASR consecutive rolling mode enabled")
                            }

                            if control.flush == true {
                                try await maybeEmitRollingPartial(force: true)
                                try await finalizeRollingSession()
                                return
                            }

                            continue
                        }

                        if text.contains("\"flush\"") {
                            reqLogger.info("Received legacy flush control frame: \(text)")
                            try await maybeEmitRollingPartial(force: true)
                            try await finalizeRollingSession()
                            return
                        }
                    }
                }

                if !bufferedSamples.isEmpty {
                    try? await maybeEmitRollingPartial(force: true)
                }
            } catch {
                reqLogger.error("ASR WebSocket ended with error: \(error.localizedDescription)")
                logFn?("ASR websocket error: \(error.localizedDescription)")
            }
            reqLogger.info("ASR WebSocket disconnected")
            logFn?("ASR client disconnected")
        }

        let app = Application(
            router: router,
            server: .http1WebSocketUpgrade(webSocketRouter: wsRouter),
            configuration: .init(address: .hostname("0.0.0.0", port: port))
        )

        isRunning = true
        serverTask = Task {
            try await app.runService()
        }
        logger.info("AI server started on port \(port)")
    }

    func stop() {
        guard isRunning else { return }
        logger.info("Stopping AI server")
        serverTask?.cancel()
        serverTask = nil
        isRunning = false
        logger.info("AI server stopped")
    }

    func shutdown() async {
        stop()
        await modelManager.shutdown()
    }
}
