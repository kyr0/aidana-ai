//
//  ASRTestClient.swift
//  Aidana
//

import AVFoundation
import FluidAudio
import Foundation

/// Test client that reads a WAV file, resamples to 16kHz mono Float32,
/// sends chunks via WebSocket to the local ASR server, and collects results.
@MainActor
final class ASRTestClient: ObservableObject {
    @Published private(set) var isRunning = false

    private let logStore: LogStore
    var modelManager: ModelManager?
    private var webSocketTask: URLSessionWebSocketTask?

    /// Web Audio API typically uses 4096-frame buffers at the source sample rate.
    /// After resampling to 16kHz, that's roughly 1485 samples per chunk.
    /// We send 4096 Float32 samples per frame (~0.256s at 16kHz) to mimic realistic streaming.
    private let chunkSize = 4096

    init(logStore: LogStore) {
        self.logStore = logStore
    }

    func runTest(port: Int) {
        guard !isRunning else { return }
        isRunning = true

        Task {
            defer { Task { @MainActor in self.isRunning = false } }

            logStore.append("TEST: Loading reference.wav…")

            guard let wavURL = findWavFile() else {
                logStore.append("TEST: reference.wav not found")
                return
            }

            guard let samples = loadAndResample(url: wavURL) else {
                logStore.append("TEST: Failed to read/resample audio")
                return
            }

            let duration = Double(samples.count) / 16000.0
            logStore.append("TEST: Loaded \(samples.count) samples (\(String(format: "%.1f", duration))s)")

            // Connect WebSocket
            let url = URL(string: "ws://localhost:\(port)/asr")!
            let session = URLSession(configuration: .default)
            let ws = session.webSocketTask(with: url)
            self.webSocketTask = ws
            ws.resume()

            logStore.append("TEST: Connected to ws://localhost:\(port)/asr")

            // Start receiving results — completes when "done":true arrives or cancelled
            let doneSignal = DoneSignal()
            let resultTask = Task.detached { [weak self] in
                await self?.receiveResults(ws: ws, doneSignal: doneSignal)
            }

            // Send audio in chunks, simulating real-time streaming
            var offset = 0
            var chunkCount = 0
            while offset < samples.count {
                let end = min(offset + chunkSize, samples.count)
                let chunk = Array(samples[offset..<end])

                let data = chunk.withUnsafeBufferPointer { buffer in
                    Data(bytes: buffer.baseAddress!, count: buffer.count * MemoryLayout<Float>.size)
                }

                let message = URLSessionWebSocketTask.Message.data(data)
                try? await ws.send(message)
                chunkCount += 1
                offset = end

                // Small delay to not overwhelm (~10ms between chunks)
                try? await Task.sleep(nanoseconds: 10_000_000)
            }

            logStore.append("TEST: Sent \(chunkCount) chunks, sending flush…")

            // Send flush command
            let flushMsg = URLSessionWebSocketTask.Message.string("{\"flush\":true}")
            try? await ws.send(flushMsg)

            // Wait for "done":true or timeout after 30s
            await doneSignal.waitForDone(timeout: 30)

            resultTask.cancel()
            ws.cancel(with: .normalClosure, reason: nil)
            self.webSocketTask = nil

            logStore.append("TEST: Complete")
        }
    }

    func cancel() {
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        webSocketTask = nil
        isRunning = false
        logStore.append("TEST: Cancelled")
    }

    // MARK: - Private

    private func findWavFile() -> URL? {
        // Check bundle resources
        if let bundled = Bundle.main.url(forResource: "reference", withExtension: "wav") {
            return bundled
        }
        // Check source directory (development)
        let sourceDir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // Support/
            .deletingLastPathComponent() // Aidana/
        let sourcePath = sourceDir.appendingPathComponent("reference.wav")
        if FileManager.default.fileExists(atPath: sourcePath.path) {
            return sourcePath
        }
        // Check project root
        let rootPath = sourceDir.deletingLastPathComponent().appendingPathComponent("reference.wav")
        if FileManager.default.fileExists(atPath: rootPath.path) {
            return rootPath
        }
        return nil
    }

    private func loadAndResample(url: URL) -> [Float]? {
        do {
            return try AudioConverter().resampleAudioFile(url)
        } catch {
            logStore.append("TEST: Resampling failed: \(error.localizedDescription)")
            return nil
        }
    }

    /// Direct test: load WAV file, transcribe via ModelManager directly (no WebSocket).
    /// This isolates whether the problem is the model or the network pipeline.
    func runDirectTest(modelManager: ModelManager) {
        guard !isRunning else { return }
        isRunning = true

        Task {
            defer { Task { @MainActor in self.isRunning = false } }

            logStore.append("DIRECT TEST: Loading reference.wav…")

            guard let wavURL = findWavFile() else {
                logStore.append("DIRECT TEST: reference.wav not found")
                return
            }

            guard let samples = loadAndResample(url: wavURL) else {
                logStore.append("DIRECT TEST: Failed to read/resample audio")
                return
            }

            let totalDuration = Double(samples.count) / 16000.0
            logStore.append("DIRECT TEST: Loaded \(samples.count) samples (\(String(format: "%.1f", totalDuration))s)")

            // Transcribe in 15s segments (same as server, Parakeet max)
            let segmentSamples = Int(16000.0 * 15.0)
            var offset = 0
            var segmentIndex = 0
            while offset < samples.count {
                let end = min(offset + segmentSamples, samples.count)
                let segment = Array(samples[offset..<end])
                let timeOffset = Double(offset) / 16000.0
                let duration = Double(segment.count) / 16000.0

                do {
                    let result = try await modelManager.transcribe(samples: segment)
                    let start = Self.formatTime(timeOffset)
                    let endTime = Self.formatTime(timeOffset + duration)
                    logStore.append("DIRECT [\(start)→\(endTime)]: \(result.text)")
                } catch {
                    logStore.append("DIRECT ERROR: \(error.localizedDescription)")
                }
                segmentIndex += 1
                offset = end
            }

            logStore.append("DIRECT TEST: Complete")
        }
    }

    private nonisolated func receiveResults(ws: URLSessionWebSocketTask, doneSignal: DoneSignal) async {
        let decoder = JSONDecoder()
        while !Task.isCancelled {
            do {
                let message = try await ws.receive()
                let text: String
                switch message {
                case .string(let s): text = s
                case .data(let d):
                    guard let s = String(data: d, encoding: .utf8) else { continue }
                    text = s
                @unknown default: continue
                }

                // Parse and display
                if let data = text.data(using: .utf8),
                   let result = try? decoder.decode(ASRResultJSON.self, from: data) {
                    let tag = result.done ? "DONE" : (result.confirmed ? "CONFIRMED" : "PARTIAL")
                    await MainActor.run { [weak self] in
                        self?.logStore.append("TEST \(tag): \(result.text)")
                    }
                    if result.done {
                        await doneSignal.markDone()
                        return
                    }
                } else {
                    await MainActor.run { [weak self] in
                        self?.logStore.append("TEST RESULT: \(text)")
                    }
                    if text.contains("\"done\":true") {
                        await doneSignal.markDone()
                        return
                    }
                }
            } catch {
                break
            }
        }
    }
}

// MARK: - Done Signal

/// Thread-safe signal for waiting on a streaming completion.
private actor DoneSignal {
    private var isDone = false
    private var continuation: CheckedContinuation<Void, Never>?

    func markDone() {
        isDone = true
        continuation?.resume()
        continuation = nil
    }

    func waitForDone(timeout: TimeInterval) async {
        if isDone { return }

        await withTaskGroup(of: Void.self) { group in
            group.addTask {
                await withCheckedContinuation { cont in
                    Task { await self.storeContinuation(cont) }
                }
            }
            group.addTask {
                try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
            }
            // Return as soon as either completes
            await group.next()
            group.cancelAll()
        }
    }

    private func storeContinuation(_ cont: CheckedContinuation<Void, Never>) {
        if isDone {
            cont.resume()
        } else {
            continuation = cont
        }
    }
}

// MARK: - JSON Parsing

private struct ASRResultJSON: Decodable {
    let text: String
    let confirmed: Bool
    let done: Bool
}

private extension ASRTestClient {
    nonisolated static func formatTime(_ seconds: Double) -> String {
        let mins = Int(seconds) / 60
        let secs = seconds - Double(mins * 60)
        return String(format: "%02d:%05.2f", mins, secs)
    }
}
