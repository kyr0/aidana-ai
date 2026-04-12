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
    private enum MCPAction: Sendable {
        case launchIfEnabled
        case applyRuntimeSettings
        case setAutoStart(Bool)
        case startManual
        case stopManual
        case restartManual
    }

    private let preferences = PreferencesStore.shared
    private let serverState = ServerState()
    private let logStore = LogStore()
    private let ttsLogStore = TTSLogStore()
    private let mcpLogStore = MCPLogStore()
    private lazy var testClient = ASRTestClient(logStore: logStore)
    private let aiServer = AIServer()
    private let ttsServer = TTSServer()
    private let mcpServer = MCPServer()
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
    private var mcpActionTask: Task<Void, Never>?
    private var mcpManualStopRequested = false
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
        mcpActionTask?.cancel()
        MCPServer.killStaleProcesses()
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
        let mcpLogRef = mcpLogStore
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
            await self.mcpServer.setLogCallback { message in
                Task { @MainActor in
                    mcpLogRef.append(message)
                }
            }
            await self.mcpServer.setLifecycleCallback { event in
                Task { @MainActor in
                    switch event {
                    case .stopped(let expected, let exitCode):
                        if expected {
                            stateRef.setMCPStatus(.stopped)
                            mcpLogRef.append("MCP server stopped")
                        } else {
                            stateRef.setMCPStatus(.error("exited (\(exitCode))"))
                            mcpLogRef.append("MCP server exited unexpectedly (\(exitCode))")
                        }
                    }
                }
            }

            let mcpStartupTask = self.enqueueMCPAction(.launchIfEnabled)

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
            await mcpStartupTask.value
        }
    }

    private func enqueueMCPAction(_ action: MCPAction) -> Task<Void, Never> {
        mcpActionTask?.cancel()

        let task = Task { @MainActor [weak self] in
            guard let self else { return }
            await self.performMCPAction(action)
        }

        mcpActionTask = task
        return task
    }

    private func performMCPAction(_ action: MCPAction) async {
        guard !Task.isCancelled else { return }

        switch action {
        case .launchIfEnabled:
            guard preferences.mcpAutoStart else {
                serverState.setMCPStatus(.stopped)
                mcpLogStore.append("MCP auto-start disabled")
                return
            }

            let isRunning = await mcpServer.isRunning
            guard !isRunning else { return }

            mcpManualStopRequested = false
            await startMCPServer(configuration: currentMCPConfiguration())

        case .applyRuntimeSettings:
            let configuration = currentMCPConfiguration()
            let isRunning = await mcpServer.isRunning

            if isRunning {
                await restartMCPServer(configuration: configuration, reason: "Applying updated MCP settings…")
            }

        case .setAutoStart(let enabled):
            if enabled {
                mcpLogStore.append("MCP auto-start enabled")

                let isRunning = await mcpServer.isRunning
                guard !isRunning && !mcpManualStopRequested else { return }
                await startMCPServer(configuration: currentMCPConfiguration())
            } else {
                mcpLogStore.append("MCP auto-start disabled for next launch")

                let isRunning = await mcpServer.isRunning
                if !isRunning {
                    serverState.setMCPStatus(.stopped)
                }
            }

        case .startManual:
            let isRunning = await mcpServer.isRunning
            guard !isRunning else {
                mcpLogStore.append("MCP server already running at \(mcpEndpoint(port: preferences.mcpPort))")
                return
            }

            mcpManualStopRequested = false
            await startMCPServer(configuration: currentMCPConfiguration())

        case .stopManual:
            mcpManualStopRequested = true
            await stopMCPServer(
                reason: "Stopping MCP server…",
                noteIfAlreadyStopped: "MCP server already stopped"
            )

        case .restartManual:
            mcpManualStopRequested = false
            await restartMCPServer(
                configuration: currentMCPConfiguration(),
                reason: "Restarting MCP server…"
            )
        }
    }

    private func currentMCPConfiguration() -> MCPServer.LaunchConfiguration {
        let workspacePath = preferences.mcpWorkspacePath.trimmingCharacters(in: .whitespacesAndNewlines)
        let effectiveWorkspacePath = workspacePath.isEmpty
            ? PreferencesStore.defaultMCPWorkspacePath
            : workspacePath

        return .init(
            mcpPort: preferences.mcpPort,
            workQueuePort: 3210,
            workspacePath: effectiveWorkspacePath
        )
    }

    private func startMCPServer(configuration: MCPServer.LaunchConfiguration) async {
        guard !Task.isCancelled else { return }

        let port = configuration.mcpPort
        serverState.setMCPStatus(.starting)
        mcpLogStore.append("Starting MCP server on port \(port)…")

        do {
            try await mcpServer.start(configuration: configuration)
        } catch {
            logger.error("MCP server start failed: \(error)")
            guard !Task.isCancelled else { return }
            serverState.setMCPStatus(.error(error.localizedDescription))
            mcpLogStore.append("MCP server error: \(error.localizedDescription)")
            return
        }

        guard !Task.isCancelled else { return }

        let ready = await mcpServer.waitForReady(port: port, timeout: 30)
        guard !Task.isCancelled else { return }

        guard ready else {
            logger.error("MCP server did not become ready within timeout")
            await mcpServer.stopAndWait()
            guard !Task.isCancelled else { return }
            serverState.setMCPStatus(.error("timeout"))
            mcpLogStore.append("MCP server timeout — not responding")
            return
        }

        serverState.setMCPStatus(.ready(port: port))
        mcpLogStore.append("MCP server ready at \(mcpEndpoint(port: port))")
    }

    private func restartMCPServer(configuration: MCPServer.LaunchConfiguration, reason: String) async {
        guard !Task.isCancelled else { return }
        mcpLogStore.append(reason)
        await mcpServer.stopAndWait()
        guard !Task.isCancelled else { return }
        await startMCPServer(configuration: configuration)
    }

    private func stopMCPServer(reason: String, noteIfAlreadyStopped: String? = nil) async {
        let isRunning = await mcpServer.isRunning
        guard isRunning else {
            serverState.setMCPStatus(.stopped)
            if let noteIfAlreadyStopped {
                mcpLogStore.append(noteIfAlreadyStopped)
            }
            return
        }

        serverState.setMCPStatus(.stopped)
        mcpLogStore.append(reason)
        await mcpServer.stopAndWait()
        guard !Task.isCancelled else { return }
        serverState.setMCPStatus(.stopped)
    }

    private func mcpEndpoint(port: Int) -> String {
        "http://127.0.0.1:\(port)/mcp"
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
            await mcpServer.stop()
            await ttsServer.stop()
            await aiServer.stop()
        }
        serverState.setStatus(.stopped)
        serverState.setASRModelReady(false)
        serverState.setTTSReady(false)
        serverState.setTTSStatus(.stopped)
        serverState.setMCPStatus(.stopped)
        logStore.append("Server stopped")
        ttsLogStore.append("TTS server stopped")
        mcpLogStore.append("MCP server stopped")
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

        NotificationCenter.default.publisher(for: .mcpStartRequested)
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                _ = self?.enqueueMCPAction(.startManual)
            }
            .store(in: &cancellables)

        NotificationCenter.default.publisher(for: .mcpStopRequested)
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                _ = self?.enqueueMCPAction(.stopManual)
            }
            .store(in: &cancellables)

        NotificationCenter.default.publisher(for: .mcpRestartRequested)
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                _ = self?.enqueueMCPAction(.restartManual)
            }
            .store(in: &cancellables)

        preferences.$mcpAutoStart
            .removeDuplicates()
            .dropFirst()
            .receive(on: RunLoop.main)
            .sink { [weak self] enabled in
                _ = self?.enqueueMCPAction(.setAutoStart(enabled))
            }
            .store(in: &cancellables)

        Publishers.CombineLatest(
            preferences.$mcpPort.removeDuplicates(),
            preferences.$mcpWorkspacePath
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .removeDuplicates()
        )
        .dropFirst()
        .debounce(for: .milliseconds(350), scheduler: RunLoop.main)
        .sink { [weak self] _, _ in
            _ = self?.enqueueMCPAction(.applyRuntimeSettings)
        }
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
                .environmentObject(mcpLogStore)
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
