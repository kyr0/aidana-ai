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

            guard let asrModels = await modelMgr.asrModels else {
                reqLogger.error("ASR models not available")
                return
            }

            // Favor low-latency hypotheses so the browser extension can render
            // streaming text while speech is still in progress.
            let streamingConfig = StreamingAsrConfig(
                chunkSeconds: 11.0,
                hypothesisChunkSeconds: 0.25,
                leftContextSeconds: 2.0,
                rightContextSeconds: 0.25,
                minContextForConfirmation: 8.0,
                confirmationThreshold: 0.82
            )
            let streamingManager = StreamingAsrManager(config: streamingConfig)
            var requestedLanguage = "auto"

            reqLogger.info("ASR WebSocket connected")
            logFn?("ASR client connected (250ms hypothesis cadence)")

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

            /// Build full text from the streaming manager's confirmed + volatile transcripts.
            func buildFullText(_ mgr: StreamingAsrManager) async -> String {
                let confirmed = await mgr.confirmedTranscript
                let volatile = await mgr.volatileTranscript
                return [confirmed, volatile].filter { !$0.isEmpty }.joined(separator: " ")
            }

            /// Extract text after the wake word, or nil if wake word not found.
            func extractAfterWakeWord(_ text: String, wakeWord: String) -> String? {
                let words = text.components(separatedBy: .whitespaces).filter { !$0.isEmpty }
                guard let idx = words.firstIndex(where: { $0.lowercased() == wakeWord }) else {
                    return nil
                }
                return words[(idx + 1)...].joined(separator: " ")
            }

            do {
                // Set up transcription updates BEFORE starting (registers the continuation)
                let updates = await streamingManager.transcriptionUpdates

                // Start streaming engine with pre-loaded models
                try await streamingManager.start(models: asrModels, source: .microphone)

                try await withThrowingTaskGroup(of: Void.self) { group in
                    // Receiver: reads WebSocket frames, feeds audio to streaming manager
                    group.addTask {
                        for try await message in inbound.messages(maxSize: 1 << 24) {
                            switch message {
                            case .binary(let byteBuffer):
                                let data = Data(buffer: byteBuffer)
                                let samples = ASRWebSocketHandler.decodePCMFrame(data)
                                if !samples.isEmpty,
                                   let buffer = ASRWebSocketHandler.createPCMBuffer(from: samples) {
                                    await streamingManager.streamAudio(buffer)
                                }
                            case .text(let text):
                                if let control = ASRWebSocketHandler.decodeControl(text) {
                                    if let language = control.language?
                                        .trimmingCharacters(in: .whitespacesAndNewlines), !language.isEmpty
                                    {
                                        requestedLanguage = language
                                        reqLogger.info("ASR language hint updated to \(requestedLanguage)")
                                        logFn?("ASR language hint: \(requestedLanguage)")
                                    }

                                    if control.flush == true {
                                        _ = try await streamingManager.finish()
                                        await streamingManager.cancel()
                                        return
                                    }

                                    continue
                                }

                                if text.contains("\"flush\"") {
                                    _ = try await streamingManager.finish()
                                    await streamingManager.cancel()
                                    return
                                }
                            }
                        }
                        // Client disconnected without flush
                        _ = try? await streamingManager.finish()
                        await streamingManager.cancel()
                    }

                    // Forwarder: reads transcription updates, applies wake word, sends to WS
                    group.addTask {
                        var lastSentText = ""
                        for await update in updates {
                            let fullText = await buildFullText(streamingManager)
                            guard fullText != lastSentText, !fullText.isEmpty else { continue }
                            lastSentText = fullText
                            let updateType = update.isConfirmed ? "CONFIRMED" : "PARTIAL"

                            let wakeWord = (wakeWordFn?() ?? "").lowercased()

                            // No wake word configured — always active
                            if wakeWord.isEmpty {
                                if !isActive { setMode(true) }
                                let result = ASRWebSocketHandler.ASRResultJSON(
                                    text: fullText, confirmed: update.isConfirmed, done: false)
                                let json = try ASRWebSocketHandler.encodeResult(result)
                                try await outbound.write(.text(json))
                                reqLogger.debug("[\(updateType)] \(fullText)")
                                logFn?("ASR \(updateType) [\(requestedLanguage)]: \(fullText)")
                                continue
                            }

                            if isActive {
                                // Active: extract text after wake word and send
                                let textToSend = extractAfterWakeWord(fullText, wakeWord: wakeWord) ?? fullText
                                if !textToSend.isEmpty {
                                    let result = ASRWebSocketHandler.ASRResultJSON(
                                        text: textToSend, confirmed: update.isConfirmed, done: false)
                                    let json = try ASRWebSocketHandler.encodeResult(result)
                                    try await outbound.write(.text(json))
                                    reqLogger.debug("[\(updateType)] \(textToSend)")
                                    logFn?("ASR \(updateType) [\(requestedLanguage)]: \(textToSend)")
                                }
                                continue
                            }

                            // IDLE: look for wake word
                            if extractAfterWakeWord(fullText, wakeWord: wakeWord) != nil {
                                setMode(true)
                                logFn?("Wake word '\(wakeWord)' detected, active listening")
                                let afterText = extractAfterWakeWord(fullText, wakeWord: wakeWord) ?? ""
                                if !afterText.isEmpty {
                                    let result = ASRWebSocketHandler.ASRResultJSON(
                                        text: afterText, confirmed: update.isConfirmed, done: false)
                                    let json = try ASRWebSocketHandler.encodeResult(result)
                                    try await outbound.write(.text(json))
                                    reqLogger.debug("[\(updateType)] \(afterText)")
                                    logFn?("ASR \(updateType) [\(requestedLanguage)]: \(afterText)")
                                }
                            } else {
                                logFn?("IDLE: \(fullText)")
                            }
                        }

                        // Updates stream ended (cancel was called after finish)
                        let finalText = await buildFullText(streamingManager)
                        let wakeWord = (wakeWordFn?() ?? "").lowercased()
                        var textToSend = finalText
                        if !wakeWord.isEmpty && isActive {
                            textToSend = extractAfterWakeWord(finalText, wakeWord: wakeWord) ?? finalText
                        }

                        let doneResult = ASRWebSocketHandler.ASRResultJSON(
                            text: textToSend, confirmed: true, done: true)
                        let json = try ASRWebSocketHandler.encodeResult(doneResult)
                        try await outbound.write(.text(json))
                        logFn?("ASR: \(textToSend) [done]")

                        // Reset mode on stream end
                        if !wakeWord.isEmpty { setMode(false) }
                    }

                    try await group.waitForAll()
                }
            } catch {
                reqLogger.debug("ASR WebSocket ended: \(error)")
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
