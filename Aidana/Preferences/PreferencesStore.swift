//
//  PreferencesStore.swift
//  Aidana
//

import Combine
import Foundation

@MainActor
final class PreferencesStore: ObservableObject {
    static let shared = PreferencesStore()

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
    }

    /// All hotwords including the wake word (if non-empty).
    var effectiveHotwords: [String] {
        var list = hotwords
        if !wakeWord.isEmpty && !list.contains(where: { $0.lowercased() == wakeWord.lowercased() }) {
            list.insert(wakeWord, at: 0)
        }
        return list
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
    }
}
