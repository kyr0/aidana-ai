//
//  LogStore.swift
//  Aidana
//

import Foundation

@MainActor
class LogStore: ObservableObject {
    struct Entry: Identifiable {
        let id = UUID()
        let timestamp: Date
        let message: String
    }

    @Published private(set) var entries: [Entry] = []

    func append(_ message: String) {
        let entry = Entry(timestamp: Date(), message: message)
        entries.append(entry)
        print("[Aidana] \(message)")
    }

    func clear() {
        entries.removeAll()
    }
}

/// Separate log store type for TTS so SwiftUI can distinguish via @EnvironmentObject.
@MainActor
final class TTSLogStore: LogStore {}

/// Separate log store type for MCP so SwiftUI can distinguish via @EnvironmentObject.
@MainActor
final class MCPLogStore: LogStore {}

/// Separate log store type for LLM so SwiftUI can distinguish via @EnvironmentObject.
@MainActor
final class LLMLogStore: LogStore {}

/// Separate log store type for Chat so SwiftUI can distinguish via @EnvironmentObject.
@MainActor
final class ChatLogStore: LogStore {}
