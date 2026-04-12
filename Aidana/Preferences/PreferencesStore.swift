//
//  PreferencesStore.swift
//  Aidana
//

import Combine
import Foundation

struct ASRRuntimeConfiguration: Equatable, Sendable {
    let wakeWord: String
    let hotwords: [String]
    let effectiveHotwords: [String]

    var hotwordBoostingEnabled: Bool {
        !effectiveHotwords.isEmpty
    }

    init(wakeWord: String = "", hotwords: [String] = []) {
        let normalizedWakeWord = Self.normalizeTerm(wakeWord)
        let normalizedHotwords = Self.normalizeUniqueTerms(hotwords)
        let filteredHotwords = normalizedHotwords.filter {
            normalizedWakeWord.isEmpty || $0.caseInsensitiveCompare(normalizedWakeWord) != .orderedSame
        }

        self.wakeWord = normalizedWakeWord
        self.hotwords = filteredHotwords
        self.effectiveHotwords = normalizedWakeWord.isEmpty ? filteredHotwords : [normalizedWakeWord] + filteredHotwords
    }

    private static func normalizeUniqueTerms(_ terms: [String]) -> [String] {
        var seen = Set<String>()
        var normalizedTerms: [String] = []

        for term in terms {
            let normalizedTerm = normalizeTerm(term)
            guard !normalizedTerm.isEmpty else { continue }

            let dedupeKey = normalizedTerm.lowercased()
            guard seen.insert(dedupeKey).inserted else { continue }

            normalizedTerms.append(normalizedTerm)
        }

        return normalizedTerms
    }

    private static func normalizeTerm(_ term: String) -> String {
        term
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

@MainActor
final class PreferencesStore: ObservableObject {
    static let shared = PreferencesStore()

    nonisolated static var defaultMCPWorkspacePath: String {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Documents", isDirectory: true)
            .appendingPathComponent("aidana-workspace", isDirectory: true)
            .path
    }

    @Published var serverPort: Int {
        didSet { defaults.set(serverPort, forKey: Keys.serverPort) }
    }

    @Published var autoStartServer: Bool {
        didSet { defaults.set(autoStartServer, forKey: Keys.autoStartServer) }
    }

    @Published var asrLanguage: String {
        didSet { defaults.set(asrLanguage, forKey: Keys.asrLanguage) }
    }

    @Published var hasCompletedOnboarding: Bool {
        didSet { defaults.set(hasCompletedOnboarding, forKey: Keys.hasCompletedOnboarding) }
    }

    @Published var wakeWord: String {
        didSet { defaults.set(wakeWord, forKey: Keys.wakeWord) }
    }

    @Published var hotwords: [String] {
        didSet { defaults.set(hotwords, forKey: Keys.hotwords) }
    }

    @Published var ttsPort: Int {
        didSet { defaults.set(ttsPort, forKey: Keys.ttsPort) }
    }

    @Published var ttsModelName: String {
        didSet { defaults.set(ttsModelName, forKey: Keys.ttsModelName) }
    }

    @Published var ttsRefAudioPath: String {
        didSet { defaults.set(ttsRefAudioPath, forKey: Keys.ttsRefAudioPath) }
    }

    @Published var ttsRefText: String {
        didSet { defaults.set(ttsRefText, forKey: Keys.ttsRefText) }
    }

    @Published var ttsLangCode: String {
        didSet { defaults.set(ttsLangCode, forKey: Keys.ttsLangCode) }
    }

    @Published var ttsSpeed: Double {
        didSet { defaults.set(ttsSpeed, forKey: Keys.ttsSpeed) }
    }

    @Published var ttsGender: String {
        didSet { defaults.set(ttsGender, forKey: Keys.ttsGender) }
    }

    @Published var ttsStreamingInterval: Double {
        didSet { defaults.set(ttsStreamingInterval, forKey: Keys.ttsStreamingInterval) }
    }

    @Published var mcpAutoStart: Bool {
        didSet { defaults.set(mcpAutoStart, forKey: Keys.mcpAutoStart) }
    }

    @Published var mcpPort: Int {
        didSet { defaults.set(mcpPort, forKey: Keys.mcpPort) }
    }

    @Published var mcpWorkspacePath: String {
        didSet { defaults.set(mcpWorkspacePath, forKey: Keys.mcpWorkspacePath) }
    }

    private let defaults: UserDefaults

    private init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        defaults.register(defaults: [
            Keys.serverPort: 31337,
            Keys.autoStartServer: true,
            Keys.asrLanguage: "auto",
            Keys.hasCompletedOnboarding: false,
            Keys.wakeWord: "",
            Keys.hotwords: [String](),
            Keys.ttsPort: 31338,
            Keys.ttsModelName: "kyr0/qwen3-TTS-12Hz-0.6B-Base-4bit-partial-quantization",
            Keys.ttsRefAudioPath: "",
            Keys.ttsRefText: "Das ist ein Referenztext.",
            Keys.ttsLangCode: "german",
            Keys.ttsSpeed: 3.0,
            Keys.ttsGender: "male",
            Keys.ttsStreamingInterval: 0.25,
            Keys.mcpAutoStart: true,
            Keys.mcpPort: 3211,
            Keys.mcpWorkspacePath: Self.defaultMCPWorkspacePath,
        ])

        let port = defaults.integer(forKey: Keys.serverPort)
        serverPort = port == 0 ? 31337 : port
        autoStartServer = defaults.bool(forKey: Keys.autoStartServer)
        asrLanguage = defaults.string(forKey: Keys.asrLanguage) ?? "auto"
        hasCompletedOnboarding = defaults.bool(forKey: Keys.hasCompletedOnboarding)
        wakeWord = defaults.string(forKey: Keys.wakeWord) ?? ""
        hotwords = defaults.stringArray(forKey: Keys.hotwords) ?? []

        let tPort = defaults.integer(forKey: Keys.ttsPort)
        ttsPort = tPort == 0 ? 31338 : tPort
        ttsModelName = defaults.string(forKey: Keys.ttsModelName) ?? "kyr0/qwen3-TTS-12Hz-0.6B-Base-4bit-partial-quantization"
        ttsRefAudioPath = defaults.string(forKey: Keys.ttsRefAudioPath) ?? ""
        ttsRefText = defaults.string(forKey: Keys.ttsRefText) ?? "Das ist ein Referenztext."
        ttsLangCode = defaults.string(forKey: Keys.ttsLangCode) ?? "german"
        let speed = defaults.double(forKey: Keys.ttsSpeed)
        ttsSpeed = speed == 0 ? 3.0 : speed
        ttsGender = defaults.string(forKey: Keys.ttsGender) ?? "male"
        let streamingInterval = defaults.double(forKey: Keys.ttsStreamingInterval)
        ttsStreamingInterval = streamingInterval == 0 ? 0.25 : streamingInterval
        mcpAutoStart = defaults.bool(forKey: Keys.mcpAutoStart)
        let storedMcpPort = defaults.integer(forKey: Keys.mcpPort)
        mcpPort = storedMcpPort == 0 ? 3211 : storedMcpPort
        mcpWorkspacePath = defaults.string(forKey: Keys.mcpWorkspacePath) ?? Self.defaultMCPWorkspacePath
    }

    /// All hotwords including the wake word (if non-empty).
    var effectiveHotwords: [String] {
        asrRuntimeConfiguration.effectiveHotwords
    }

    var asrRuntimeConfiguration: ASRRuntimeConfiguration {
        ASRRuntimeConfiguration(wakeWord: wakeWord, hotwords: hotwords)
    }

    private enum Keys {
        static let serverPort = "preferences.serverPort"
        static let autoStartServer = "preferences.autoStartServer"
        static let asrLanguage = "preferences.asrLanguage"
        static let hasCompletedOnboarding = "preferences.hasCompletedOnboarding"
        static let wakeWord = "preferences.wakeWord"
        static let hotwords = "preferences.hotwords"
        static let ttsPort = "preferences.ttsPort"
        static let ttsModelName = "preferences.ttsModelName"
        static let ttsRefAudioPath = "preferences.ttsRefAudioPath"
        static let ttsRefText = "preferences.ttsRefText"
        static let ttsLangCode = "preferences.ttsLangCode"
        static let ttsSpeed = "preferences.ttsSpeed"
        static let ttsGender = "preferences.ttsGender"
        static let ttsStreamingInterval = "preferences.ttsStreamingInterval"
        static let mcpAutoStart = "preferences.mcpAutoStart"
        static let mcpPort = "preferences.mcpPort"
        static let mcpWorkspacePath = "preferences.mcpWorkspacePath"
    }
}
