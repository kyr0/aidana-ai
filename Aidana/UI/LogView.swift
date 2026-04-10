//
//  LogView.swift
//  Aidana
//

import AppKit
import SwiftUI

struct LogView: View {
    @EnvironmentObject private var asrLogStore: LogStore
    @EnvironmentObject private var ttsLogStore: TTSLogStore
    @EnvironmentObject private var serverState: ServerState
    @EnvironmentObject private var testClient: ASRTestClient

    var body: some View {
        TabView {
            ASRLogTab()
                .environmentObject(asrLogStore)
                .environmentObject(serverState)
                .environmentObject(testClient)
                .tabItem { Label("ASR", systemImage: "waveform") }

            TTSLogTab()
                .environmentObject(ttsLogStore)
                .tabItem { Label("TTS", systemImage: "speaker.wave.2") }
        }
        .frame(width: 520, height: 360)
    }
}

// MARK: - ASR Log Tab

private struct ASRLogTab: View {
    @EnvironmentObject private var logStore: LogStore
    @EnvironmentObject private var serverState: ServerState
    @EnvironmentObject private var testClient: ASRTestClient

    var body: some View {
        VStack(spacing: 0) {
            LogPanelView(entries: logStore.entries)

            Divider()

            HStack {
                Text("\(logStore.entries.count) entries")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Spacer()
                if testClient.isRunning {
                    Button("Cancel Test") {
                        testClient.cancel()
                    }
                    .buttonStyle(.borderless)
                    .font(.caption)
                } else {
                    Button("Direct Test") {
                        if let mm = testClient.modelManager {
                            testClient.runDirectTest(modelManager: mm)
                        }
                    }
                    .buttonStyle(.borderless)
                    .font(.caption)
                    .disabled(!serverState.asrModelReady)
                    Button("WS Test") {
                        if case .running(let port) = serverState.status {
                            testClient.runTest(port: port)
                        }
                    }
                    .buttonStyle(.borderless)
                    .font(.caption)
                    .disabled(!serverState.status.isRunning)
                }
                Button("Copy") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(logText(logStore.entries), forType: .string)
                }
                .buttonStyle(.borderless)
                .font(.caption)
                Button("Clear") {
                    logStore.clear()
                }
                .buttonStyle(.borderless)
                .font(.caption)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
        }
    }
}

// MARK: - TTS Log Tab

private struct TTSLogTab: View {
    @EnvironmentObject private var logStore: TTSLogStore

    var body: some View {
        VStack(spacing: 0) {
            LogPanelView(entries: logStore.entries)

            Divider()

            HStack {
                Text("\(logStore.entries.count) entries")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Spacer()
                Button("Copy") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(logText(logStore.entries), forType: .string)
                }
                .buttonStyle(.borderless)
                .font(.caption)
                Button("Clear") {
                    logStore.clear()
                }
                .buttonStyle(.borderless)
                .font(.caption)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
        }
    }
}

// MARK: - Shared Log Panel

private struct LogPanelView: View {
    let entries: [LogStore.Entry]

    private static let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss"
        return f
    }()

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                Text(
                    entries.map { entry in
                        "\(Self.timeFormatter.string(from: entry.timestamp))  \(entry.message)"
                    }.joined(separator: "\n")
                )
                .font(.system(.caption, design: .monospaced))
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
                .padding(8)
                .id("logBottom")
            }
            .onChange(of: entries.count) { _ in
                withAnimation {
                    proxy.scrollTo("logBottom", anchor: .bottom)
                }
            }
        }
    }
}

// MARK: - Helpers

private let _timeFormatter: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "HH:mm:ss"
    return f
}()

private func logText(_ entries: [LogStore.Entry]) -> String {
    entries.map { entry in
        "\(_timeFormatter.string(from: entry.timestamp))  \(entry.message)"
    }.joined(separator: "\n")
}
