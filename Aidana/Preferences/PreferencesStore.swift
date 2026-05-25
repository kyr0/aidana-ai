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

    // MARK: - LLM Configuration

    @Published var llmEndpoint: String {
        didSet {
            defaults.set(llmEndpoint, forKey: Keys.llmEndpoint)
            saveLlmConfig()
        }
    }

    @Published var llmApiKey: String {
        didSet {
            defaults.set(llmApiKey, forKey: Keys.llmApiKey)
            saveLlmConfig()
        }
    }

    @Published var llmModel: String {
        didSet {
            defaults.set(llmModel, forKey: Keys.llmModel)
            saveLlmConfig()
        }
    }

    @Published var llmAutoStart: Bool {
        didSet {
            defaults.set(llmAutoStart, forKey: Keys.llmAutoStart)
            saveLlmConfig()
        }
    }

    @Published var llmProxyPort: Int {
        didSet {
            defaults.set(llmProxyPort, forKey: Keys.llmProxyPort)
            saveLlmConfig()
        }
    }

    @Published var llmProxyAdminUser: String {
        didSet {
            defaults.set(llmProxyAdminUser, forKey: Keys.llmProxyAdminUser)
            saveLlmConfig()
        }
    }

    @Published var llmProxyAdminPassword: String {
        didSet {
            defaults.set(llmProxyAdminPassword, forKey: Keys.llmProxyAdminPassword)
            saveLlmConfig()
        }
    }

    // MARK: - Chat Configuration

    @Published var chatAutoStart: Bool {
        didSet {
            defaults.set(chatAutoStart, forKey: Keys.chatAutoStart)
            saveChatConfig()
        }
    }

    @Published var chatPort: Int {
        didSet {
            defaults.set(chatPort, forKey: Keys.chatPort)
            saveChatConfig()
        }
    }

    private let defaults: UserDefaults

    // MARK: - Config.json helpers

    private static let configURL: URL = {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".aidana", isDirectory: true)
            .appendingPathComponent("config.json")
    }()

    private struct LlmConfig: Decodable, Sendable {
        var endpoint: String = ""
        var apiKey: String = ""
        var model: String = ""
        var autoStart: Bool = true
        var proxy: ProxyConfig = ProxyConfig()

        var proxyPort: Int { proxy.port }
        var proxyAdminUser: String { proxy.adminUser }
        var proxyAdminPassword: String { proxy.adminPassword }

        struct ProxyConfig: Decodable, Sendable {
            var port: Int = 8010
            var admin_user: String = "admin"
            var admin_password: String = "changeme"
            var autoStart: Bool = true

            var adminUser: String { admin_user }
            var adminPassword: String { admin_password }
        }
    }

    /// Read LLM config from ~/.aidana/config.json if it exists.
    private static func readLlmConfig() -> LlmConfig? {
        guard let data = try? Data(contentsOf: configURL),
              let config = try? JSONDecoder().decode([String: LlmConfig].self, from: data) else {
            return nil
        }
        return config["llm"]
    }

    private struct ChatConfig: Decodable, Sendable {
        var autoStart: Bool = true
        var port: Int = 8015
    }

    /// Read chat config from ~/.aidana/config.json if it exists.
    private static func readChatConfig() -> ChatConfig? {
        guard let data = try? Data(contentsOf: configURL),
              let config = try? JSONDecoder().decode([String: ChatConfig].self, from: data) else {
            return nil
        }
        return config["chat"]
    }

    /// Ensure ~/.aidana/config.json exists with default LLM config.
    private static func ensureConfigFile() {
        let directory = configURL.deletingLastPathComponent()
        if !FileManager.default.fileExists(atPath: directory.path) {
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        }

        if !FileManager.default.fileExists(atPath: configURL.path) {
            // Create with defaults
            let defaults: [String: Any] = [
                "llm": [
                    "endpoint": "",
                    "apiKey": "",
                    "model": "",
                    "autoStart": true,
                    "proxy": [
                        "port": 8010,
                        "admin_user": "admin",
                        "admin_password": "changeme",
                        "autoStart": true
                    ]
                ]
            ]
            if let data = try? JSONSerialization.data(withJSONObject: defaults, options: .prettyPrinted) {
                try? data.write(to: configURL, options: .atomic)
            }
        }
    }

    /// Write current LLM preferences back to config.json.
    private func saveLlmConfig() {
        let directory = Self.configURL.deletingLastPathComponent()
        if !FileManager.default.fileExists(atPath: directory.path) {
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        }

        // Read existing config to preserve other sections
        var existing = (try? JSONSerialization.jsonObject(with: Data(contentsOf: Self.configURL), options: []) as? [String: Any]) ?? [:]

        let llmDict: [String: Any] = [
            "endpoint": llmEndpoint,
            "apiKey": llmApiKey,
            "model": llmModel,
            "autoStart": llmAutoStart,
            "proxy": [
                "port": llmProxyPort,
                "admin_user": llmProxyAdminUser,
                "admin_password": llmProxyAdminPassword,
                "autoStart": llmAutoStart
            ]
        ]
        existing["llm"] = llmDict

        if let data = try? JSONSerialization.data(withJSONObject: existing, options: .prettyPrinted) {
            try? data.write(to: Self.configURL, options: .atomic)
        }
    }

    /// Write current chat preferences back to config.json.
    private func saveChatConfig() {
        let directory = Self.configURL.deletingLastPathComponent()
        if !FileManager.default.fileExists(atPath: directory.path) {
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        }

        // Read existing config to preserve other sections
        var existing = (try? JSONSerialization.jsonObject(with: Data(contentsOf: Self.configURL), options: []) as? [String: Any]) ?? [:]

        let chatDict: [String: Any] = [
            "autoStart": chatAutoStart,
            "port": chatPort
        ]
        existing["chat"] = chatDict

        if let data = try? JSONSerialization.data(withJSONObject: existing, options: .prettyPrinted) {
            try? data.write(to: Self.configURL, options: .atomic)
        }
    }

    private init(defaults: UserDefaults = .standard) {
        Self.ensureConfigFile()
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
            Keys.llmEndpoint: "",
            Keys.llmApiKey: "",
            Keys.llmModel: "",
            Keys.llmAutoStart: true,
            Keys.llmProxyPort: 8010,
            Keys.llmProxyAdminUser: "admin",
            Keys.llmProxyAdminPassword: "changeme",
            Keys.chatAutoStart: true,
            Keys.chatPort: 8015,
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

        // LLM configuration — read from config.json first, fall back to UserDefaults
        let config = Self.readLlmConfig()
        llmEndpoint = config?.endpoint ?? (defaults.string(forKey: Keys.llmEndpoint) ?? "")
        llmApiKey = config?.apiKey ?? (defaults.string(forKey: Keys.llmApiKey) ?? "")
        llmModel = config?.model ?? (defaults.string(forKey: Keys.llmModel) ?? "")
        llmAutoStart = config?.autoStart ?? defaults.bool(forKey: Keys.llmAutoStart)
        llmProxyPort = config?.proxyPort ?? (defaults.integer(forKey: Keys.llmProxyPort) == 0 ? 8010 : defaults.integer(forKey: Keys.llmProxyPort))
        llmProxyAdminUser = config?.proxyAdminUser ?? (defaults.string(forKey: Keys.llmProxyAdminUser) ?? "admin")
        llmProxyAdminPassword = config?.proxyAdminPassword ?? (defaults.string(forKey: Keys.llmProxyAdminPassword) ?? "changeme")

        // Chat configuration — read from config.json first, fall back to UserDefaults
        let chatConfig = Self.readChatConfig()
        chatAutoStart = chatConfig?.autoStart ?? defaults.bool(forKey: Keys.chatAutoStart)
        chatPort = chatConfig?.port ?? (defaults.integer(forKey: Keys.chatPort) == 0 ? 8015 : defaults.integer(forKey: Keys.chatPort))
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
        static let llmEndpoint = "preferences.llmEndpoint"
        static let llmApiKey = "preferences.llmApiKey"
        static let llmModel = "preferences.llmModel"
        static let llmAutoStart = "preferences.llmAutoStart"
        static let llmProxyPort = "preferences.llmProxyPort"
        static let llmProxyAdminUser = "preferences.llmProxyAdminUser"
        static let llmProxyAdminPassword = "preferences.llmProxyAdminPassword"
        static let chatAutoStart = "preferences.chatAutoStart"
        static let chatPort = "preferences.chatPort"
    }
}
