//
//  AppDelegate.swift
//  Aidana
//

import AppKit
import Combine
import os
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private let preferences = PreferencesStore.shared
    private let serverState = ServerState()
    private let logStore = LogStore()
    private let ttsLogStore = TTSLogStore()
    private lazy var testClient = ASRTestClient(logStore: logStore)
    private let aiServer = AIServer()
    private let ttsServer = TTSServer()
    private lazy var statusBarController = StatusBarController(
        serverState: serverState,
        preferences: preferences
    ) { [weak self] in
        self?.terminate()
    }

    private var cancellables = Set<AnyCancellable>()
    private var preferencesWindowController: NSWindowController?
    private var logWindowController: NSWindowController?
    private var serverLifecycleTask: Task<Void, Never>?
    private let logger = Logger(subsystem: "de.aronhomberg.aidana", category: "AppDelegate")

    func applicationDidFinishLaunching(_ notification: Notification) {
        _ = statusBarController
        testClient.modelManager = aiServer.modelManager
        observeMenuRequests()
        startServer()
    }

    func applicationWillTerminate(_ notification: Notification) {
        logStore.append("Shutting down…")
        serverLifecycleTask?.cancel()
        // Kill TTS synchronously — can't await in willTerminate
        TTSServer.killStaleProcesses()
        Task {
            await aiServer.shutdown()
        }
    }

    // MARK: - Server Lifecycle

    private func startServer() {
        serverLifecycleTask?.cancel()

        let logRef = logStore
        let ttsLogRef = ttsLogStore
        let stateRef = serverState

        serverLifecycleTask = Task { [weak self] in
            guard let self else { return }

            // Set up callbacks first (awaited so they're ready before anything starts)
            await self.aiServer.setLogCallback { message in
                Task { @MainActor in logRef.append(message) }
            }
            await self.aiServer.setModeChangeCallback { mode in
                Task { @MainActor in
                    stateRef.setListeningMode(mode == "active" ? .active : .idle)
                }
            }
            await self.aiServer.setWakeWordProvider {
                UserDefaults.standard.string(forKey: "preferences.wakeWord") ?? ""
            }
            await self.ttsServer.setLogCallback { message in
                Task { @MainActor in
                    ttsLogRef.append(message)
                    // Parse download progress from "Fetching N files:  XX%"
                    if message.contains("Fetching") && message.contains("%") {
                        if let range = message.range(of: #"(\d+)%"#, options: .regularExpression),
                           let pct = Int(message[range].dropLast()) {
                            stateRef.setTTSStatus(.downloading(progress: pct))
                        } else {
                            stateRef.setTTSStatus(.downloading(progress: nil))
                        }
                    } else if message.contains("Initialized") || message.contains("Loaded speech tokenizer") {
                        stateRef.setTTSStatus(.loading)
                    }
                }
            }

            // Set TTS to starting immediately
            await MainActor.run {
                self.serverState.setTTSStatus(.starting)
            }

            let port = self.preferences.serverPort
            let cached = ModelManager.modelsAreCached()
            await MainActor.run {
                if cached {
                    self.serverState.setStatus(.loading)
                    self.logStore.append("Loading ASR models…")
                } else {
                    self.serverState.setStatus(.downloading(progress: nil))
                    self.logStore.append("Downloading ASR models…")
                }
            }

            do {
                try await self.aiServer.modelManager.prepareASR()
                await MainActor.run {
                    self.logStore.append("Warming ASR inference…")
                }

                do {
                    let warmupDuration = try await self.aiServer.modelManager.warmupASR()
                    let warmupMs = Int(warmupDuration * 1000)
                    await MainActor.run {
                        self.logStore.append("ASR warmup complete (\(warmupMs) ms)")
                    }
                } catch {
                    self.logger.error("ASR warmup failed: \(error)")
                    await MainActor.run {
                        self.logStore.append("ASR warmup failed: \(error.localizedDescription)")
                    }
                }

                await MainActor.run {
                    self.serverState.setASRModelReady(true)
                    self.logStore.append("ASR models loaded")
                }
            } catch {
                self.logger.error("ASR model preparation failed: \(error)")
                await MainActor.run {
                    self.logStore.append("ASR model error: \(error.localizedDescription)")
                }
            }

            do {
                await MainActor.run {
                    self.serverState.setStatus(.starting)
                    self.logStore.append("Starting server on port \(port)…")
                }
                try await self.aiServer.start(port: port)
                await MainActor.run {
                    self.serverState.setStatus(.running(port: port))
                    self.logStore.append("Server listening on port \(port)")
                }
            } catch {
                self.logger.error("Server start failed: \(error)")
                await MainActor.run {
                    self.serverState.setStatus(.error(error.localizedDescription))
                    self.logStore.append("Server error: \(error.localizedDescription)")
                }
            }

            // Start TTS sidecar
            await self.startTTSServer()
        }
    }

    private func startTTSServer() async {
        let ttsPort = await MainActor.run { preferences.ttsPort }
        let modelName = await MainActor.run { preferences.ttsModelName }

        await MainActor.run {
            ttsLogStore.append("Starting TTS server on port \(ttsPort)…")
        }

        do {
            try await ttsServer.start(port: ttsPort)
        } catch {
            logger.error("TTS server start failed: \(error)")
            await MainActor.run {
                ttsLogStore.append("TTS server error: \(error.localizedDescription)")
            }
            return
        }

        await MainActor.run {
            ttsLogStore.append("Waiting for TTS server to be ready…")
        }

        let ready = await ttsServer.waitForReady(port: ttsPort, timeout: 120)
        guard ready else {
            logger.error("TTS server did not become ready within timeout")
            await MainActor.run {
                ttsLogStore.append("TTS server timeout — not responding")
            }
            return
        }

        await MainActor.run {
            serverState.setTTSStatus(.loading)
            ttsLogStore.append("TTS server ready, preloading model…")
        }

        do {
            try await ttsServer.preloadModel(modelName, port: ttsPort)
            await MainActor.run {
                ttsLogStore.append("Warming TTS inference…")
            }

            do {
                let warmupConfig = await MainActor.run { self.currentTTSWarmupConfig(modelName: modelName) }
                let metrics = try await ttsServer.warmup(config: warmupConfig, port: ttsPort)
                await MainActor.run {
                    ttsLogStore.append(
                        "TTS warmup complete (first byte \(metrics.firstByteLatencyMs) ms, total \(metrics.totalDurationMs) ms)"
                    )
                }
            } catch {
                logger.error("TTS warmup failed: \(error)")
                await MainActor.run {
                    ttsLogStore.append("TTS warmup failed: \(error.localizedDescription)")
                }
            }

            await MainActor.run {
                serverState.setTTSReady(true, port: ttsPort)
                ttsLogStore.append("TTS model loaded: \(modelName)")
            }
        } catch {
            logger.error("TTS model preload failed: \(error)")
            await MainActor.run {
                serverState.setTTSStatus(.error("preload failed"))
                ttsLogStore.append("TTS model preload error: \(error.localizedDescription)")
            }
            return
        }

        // Start health check loop
        await startTTSHealthCheck(port: ttsPort, modelName: modelName)
    }

    private func startTTSHealthCheck(port: Int, modelName: String) async {
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 10_000_000_000) // 10s
            guard !Task.isCancelled else { return }

            let alive = await ttsServer.waitForReady(port: port, timeout: 5)
            await MainActor.run {
                if alive {
                    if !serverState.ttsReady {
                        serverState.setTTSReady(true, port: port)
                        ttsLogStore.append("TTS server recovered")
                    }
                } else {
                    if serverState.ttsReady {
                        serverState.setTTSReady(false)
                        serverState.setTTSStatus(.error("not responding"))
                        ttsLogStore.append("TTS server not responding")
                    }
                }
            }
        }
    }

    private func stopServer() {
        serverLifecycleTask?.cancel()
        serverLifecycleTask = nil
        Task {
            await ttsServer.stop()
            await aiServer.stop()
        }
        serverState.setStatus(.stopped)
        serverState.setASRModelReady(false)
        serverState.setTTSReady(false)
        serverState.setTTSStatus(.stopped)
        logStore.append("Server stopped")
        ttsLogStore.append("TTS server stopped")
    }

    private func currentTTSWarmupConfig(modelName: String) -> TTSServer.WarmupConfig {
        let configuredRefAudio = preferences.ttsRefAudioPath.trimmingCharacters(in: .whitespacesAndNewlines)
        let fallbackRefAudio = TTSServer.defaultReferenceAudioPath()
        return TTSServer.WarmupConfig(
            modelName: modelName,
            refAudioPath: configuredRefAudio.isEmpty ? fallbackRefAudio : configuredRefAudio,
            refText: preferences.ttsRefText,
            langCode: preferences.ttsLangCode,
            speed: preferences.ttsSpeed,
            gender: preferences.ttsGender,
            text: "Hallo.",
            streamingInterval: preferences.ttsStreamingInterval,
            maxTokens: 128,
        )
    }
}

// MARK: - Menu Observers

private extension AppDelegate {
    func observeMenuRequests() {
        NotificationCenter.default.publisher(for: .statusBarLogRequested)
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in self?.showLogWindow() }
            .store(in: &cancellables)

        NotificationCenter.default.publisher(for: .statusBarPreferencesRequested)
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in self?.showPreferencesWindow(nil) }
            .store(in: &cancellables)
    }

}

// MARK: - Preferences Window

extension AppDelegate {
    @objc private func showPreferencesWindow(_ sender: Any?) {
        if let controller = preferencesWindowController, let window = controller.window {
            window.makeKeyAndOrderFront(sender)
            NSApp.activate(ignoringOtherApps: true)
            return
        }

        let hostingController = NSHostingController(
            rootView: PreferencesView().environmentObject(preferences).environmentObject(serverState)
        )
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 460, height: 400),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "Aidana Settings"
        window.center()
        window.contentViewController = hostingController
        window.isReleasedWhenClosed = false
        window.delegate = self

        let controller = NSWindowController(window: window)
        preferencesWindowController = controller
        controller.showWindow(sender)
        NSApp.activate(ignoringOtherApps: true)
    }

    func windowWillClose(_ notification: Notification) {
        guard let window = notification.object as? NSWindow else { return }
        if window === preferencesWindowController?.window {
            preferencesWindowController = nil
        } else if window === logWindowController?.window {
            logWindowController = nil
        }
    }
}

// MARK: - Log Window

extension AppDelegate {
    private func showLogWindow() {
        if let controller = logWindowController, let window = controller.window {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }

        let hostingController = NSHostingController(
            rootView: LogView()
                .environmentObject(logStore)
                .environmentObject(ttsLogStore)
                .environmentObject(serverState)
                .environmentObject(testClient)
        )
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 520, height: 360),
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Aidana Log"
        window.center()
        window.contentViewController = hostingController
        window.isReleasedWhenClosed = false
        window.delegate = self

        let controller = NSWindowController(window: window)
        logWindowController = controller
        controller.showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
}

// MARK: - Misc

private extension AppDelegate {
    func terminate() {
        NSApp.terminate(nil)
    }
}
