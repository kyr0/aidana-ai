//
//  ASRWebSocketHandler.swift
//  Aidana
//

import AVFoundation
import Foundation

/// Static helpers for ASR WebSocket frame encoding/decoding.
/// Streaming transcription is handled directly via FluidAudio's StreamingAsrManager.
enum ASRWebSocketHandler {
    static let sampleRate: Double = 16_000

    /// JSON result sent over WebSocket.
    struct ASRResultJSON: Codable, Sendable {
        let text: String
        let confirmed: Bool
        let done: Bool
    }

    /// JSON control message received from WebSocket clients.
    struct ASRControlJSON: Codable, Sendable {
        let flush: Bool?
        let language: String?
        let ignoreWakeWord: Bool?
        let consecutive: Bool?
    }

    /// Decode a binary WebSocket frame to Float32 PCM samples.
    static func decodePCMFrame(_ data: Data) -> [Float] {
        let count = data.count / MemoryLayout<Float>.size
        guard count > 0 else { return [] }
        return data.withUnsafeBytes { raw in
            let buffer = raw.bindMemory(to: Float.self)
            return Array(buffer.prefix(count))
        }
    }

    /// Create an AVAudioPCMBuffer from Float32 samples at 16kHz mono.
    static func createPCMBuffer(from samples: [Float]) -> AVAudioPCMBuffer? {
        guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1),
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count))
        else { return nil }
        buffer.frameLength = AVAudioFrameCount(samples.count)
        if let channelData = buffer.floatChannelData {
            samples.withUnsafeBufferPointer { src in
                channelData[0].update(from: src.baseAddress!, count: samples.count)
            }
        }
        return buffer
    }

    /// Encode a result to JSON string.
    static func encodeResult(_ result: ASRResultJSON) throws -> String {
        let data = try JSONEncoder().encode(result)
        return String(data: data, encoding: .utf8) ?? "{}"
    }

    /// Decode a text control frame from the client.
    static func decodeControl(_ text: String) -> ASRControlJSON? {
        guard let data = text.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(ASRControlJSON.self, from: data)
    }
}
