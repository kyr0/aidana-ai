//
//  PreferencesView.swift
//  Aidana
//

import FluidAudio
import SwiftUI
import UniformTypeIdentifiers

struct PreferencesView: View {
    @EnvironmentObject private var preferences: PreferencesStore
    @EnvironmentObject private var serverState: ServerState
    @State private var newHotword: String = ""

    private let modelCacheDirectory = ModelManager.modelCacheDirectory

    var body: some View {
        TabView {
            ASRPreferencesTab(
                preferences: preferences,
                serverState: serverState,
                newHotword: $newHotword,
                modelCacheDirectory: modelCacheDirectory
            )
            .tabItem { Label("ASR", systemImage: "waveform") }

            TTSPreferencesTab(preferences: preferences, serverState: serverState)
                .tabItem { Label("TTS", systemImage: "speaker.wave.2") }
        }
        .frame(width: 460, height: 560)
    }
}

// MARK: - ASR Tab

private struct ASRPreferencesTab: View {
    @ObservedObject var preferences: PreferencesStore
    @ObservedObject var serverState: ServerState
    @Binding var newHotword: String
    let modelCacheDirectory: URL

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Status
                GroupBox("Status") {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Circle()
                                .fill(statusColor)
                                .frame(width: 8, height: 8)
                            Text(serverState.status.displayText)
                                .font(.system(.body, design: .monospaced))
                        }
                        if serverState.status.isRunning {
                            HStack {
                                Circle()
                                    .fill(serverState.listeningMode == .active ? .red : .orange)
                                    .frame(width: 8, height: 8)
                                Text(serverState.listeningMode == .active ? "Active Listening" : "Idle Listening")
                                    .font(.system(.body, design: .monospaced))
                            }
                        }
                    }
                    .padding(8)
                }

                // Server section
                GroupBox("Server") {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("Port")
                                .frame(width: 100, alignment: .leading)
                            TextField(
                                "31337",
                                value: $preferences.serverPort,
                                formatter: NumberFormatter.integerOnly
                            )
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 100)
                        }

                        Toggle("Start server automatically on launch", isOn: $preferences.autoStartServer)
                    }
                    .padding(8)
                }

                // Wake Word section
                GroupBox("Wake Word") {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("Wake Word")
                                .frame(width: 100, alignment: .leading)
                            TextField("e.g. aidana", text: $preferences.wakeWord)
                                .textFieldStyle(.roundedBorder)
                                .frame(width: 200)
                        }
                        Text("When detected in transcription, switches from idle to active listening. Leave empty to always be active.")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .padding(8)
                }

                // Hotwords section
                GroupBox("Hotwords") {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Words to boost in recognition accuracy:")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        if !preferences.wakeWord.isEmpty {
                            HStack {
                                Text(preferences.wakeWord)
                                    .font(.system(.body, design: .monospaced))
                                Text("(wake word)")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }

                        ForEach(preferences.hotwords, id: \.self) { word in
                            HStack {
                                Text(word)
                                    .font(.system(.body, design: .monospaced))
                                Spacer()
                                Button(role: .destructive) {
                                    preferences.hotwords.removeAll { $0 == word }
                                } label: {
                                    Image(systemName: "minus.circle")
                                }
                                .buttonStyle(.borderless)
                            }
                        }

                        HStack {
                            TextField("Add hotword…", text: $newHotword)
                                .textFieldStyle(.roundedBorder)
                                .onSubmit { addHotword() }
                            Button("Add") { addHotword() }
                                .disabled(newHotword.trimmingCharacters(in: .whitespaces).isEmpty)
                        }
                    }
                    .padding(8)
                }

                // Model section
                GroupBox("Model") {
                    VStack(alignment: .leading, spacing: 8) {
                        Label(
                            serverState.asrModelReady ? "Parakeet TDT v3 Ready" : "Not Loaded",
                            systemImage: serverState.asrModelReady ? "checkmark.circle.fill" : "circle"
                        )
                        .foregroundColor(serverState.asrModelReady ? .green : .secondary)
                        .font(.caption)

                        HStack {
                            Text(modelCacheDirectory.path(percentEncoded: false))
                                .font(.system(.caption, design: .monospaced))
                                .lineLimit(2)
                                .truncationMode(.middle)
                                .textSelection(.enabled)
                            Spacer()
                            Button("Show in Finder") {
                                NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: modelCacheDirectory.path(percentEncoded: false))
                            }
                        }
                    }
                    .padding(8)
                }

                Spacer()
            }
            .padding(24)
        }
    }

    private var statusColor: Color {
        switch serverState.status {
        case .running: return .green
        case .stopped: return .gray
        case .starting, .downloading, .loading: return .orange
        case .error: return .red
        }
    }

    private func addHotword() {
        let trimmed = newHotword.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        if !preferences.hotwords.contains(trimmed) {
            preferences.hotwords.append(trimmed)
        }
        newHotword = ""
    }
}

// MARK: - TTS Tab

private struct TTSPreferencesTab: View {
    @ObservedObject var preferences: PreferencesStore
    @ObservedObject var serverState: ServerState

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Status
                GroupBox("Status") {
                    HStack {
                        Circle()
                            .fill(ttsStatusColor)
                            .frame(width: 8, height: 8)
                        Text(serverState.ttsStatus.displayText)
                            .font(.system(.body, design: .monospaced))
                    }
                    .padding(8)
                }

                // Server
                GroupBox("Server") {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("Port")
                                .frame(width: 100, alignment: .leading)
                            TextField(
                                "31338",
                                value: $preferences.ttsPort,
                                formatter: NumberFormatter.integerOnly
                            )
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 100)
                        }

                        HStack {
                            Text("Model")
                                .frame(width: 100, alignment: .leading)
                            TextField("HuggingFace model name", text: $preferences.ttsModelName)
                                .textFieldStyle(.roundedBorder)
                        }
                    }
                    .padding(8)
                }

                // Voice
                GroupBox("Voice") {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("Ref Audio")
                                .frame(width: 100, alignment: .leading)
                            TextField("Path to reference audio", text: $preferences.ttsRefAudioPath)
                                .textFieldStyle(.roundedBorder)
                            Button("Browse…") {
                                let panel = NSOpenPanel()
                                panel.allowedContentTypes = [.wav, .audio]
                                panel.canChooseDirectories = false
                                if panel.runModal() == .OK, let url = panel.url {
                                    preferences.ttsRefAudioPath = url.path
                                }
                            }
                        }

                        HStack {
                            Text("Ref Text")
                                .frame(width: 100, alignment: .leading)
                            TextField("Reference transcript", text: $preferences.ttsRefText)
                                .textFieldStyle(.roundedBorder)
                        }

                        HStack {
                            Text("Language")
                                .frame(width: 100, alignment: .leading)
                            TextField("e.g. german", text: $preferences.ttsLangCode)
                                .textFieldStyle(.roundedBorder)
                                .frame(width: 120)
                        }

                        HStack {
                            Text("Speed")
                                .frame(width: 100, alignment: .leading)
                            TextField(
                                "3.0",
                                value: $preferences.ttsSpeed,
                                formatter: NumberFormatter.decimal
                            )
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 80)
                        }

                        HStack {
                            Text("Gender")
                                .frame(width: 100, alignment: .leading)
                            Picker("", selection: $preferences.ttsGender) {
                                Text("Male").tag("male")
                                Text("Female").tag("female")
                            }
                            .pickerStyle(.segmented)
                            .frame(width: 160)
                        }
                    }
                    .padding(8)
                }

                // Model cache
                GroupBox("Model") {
                    VStack(alignment: .leading, spacing: 8) {
                        Label(
                            serverState.ttsReady ? "\(preferences.ttsModelName)" : "Not Loaded",
                            systemImage: serverState.ttsReady ? "checkmark.circle.fill" : "circle"
                        )
                        .foregroundColor(serverState.ttsReady ? .green : .secondary)
                        .font(.caption)

                        HStack {
                            Text(ttsModelCacheDir.path(percentEncoded: false))
                                .font(.system(.caption, design: .monospaced))
                                .lineLimit(2)
                                .truncationMode(.middle)
                                .textSelection(.enabled)
                            Spacer()
                            Button("Show in Finder") {
                                NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: ttsModelCacheDir.path(percentEncoded: false))
                            }
                        }
                    }
                    .padding(8)
                }

                Spacer()
            }
            .padding(24)
        }
    }

    private var ttsStatusColor: Color {
        switch serverState.ttsStatus {
        case .ready: return .green
        case .stopped: return .gray
        case .starting, .downloading, .loading: return .orange
        case .error: return .red
        }
    }

    private var ttsModelCacheDir: URL {
        let home = FileManager.default.homeDirectoryForCurrentUser
        return home.appendingPathComponent(".cache/huggingface/hub")
    }
}

private extension NumberFormatter {
    static let integerOnly: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .none
        f.allowsFloats = false
        f.minimum = 1
        f.maximum = 65535
        return f
    }()

    static let decimal: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.minimum = 0.1
        f.maximum = 10
        f.maximumFractionDigits = 1
        return f
    }()
}
