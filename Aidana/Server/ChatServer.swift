//
//  ChatServer.swift
//  Aidana
//

import Foundation
import os

/// Manages the chat Astro app as a Bun subprocess.
actor ChatServer {
    private let logger = Logger(subsystem: "de.aronhomberg.aidana", category: "ChatServer")
    private var process: Process?
    private var stdoutPipe: Pipe?
    private var stderrPipe: Pipe?
    var onLog: (@Sendable (String) -> Void)?

    private(set) var isRunning = false

    struct LaunchConfiguration: Sendable {
        let chatPort: Int
    }

    func setLogCallback(_ callback: @escaping @Sendable (String) -> Void) {
        onLog = callback
    }

    /// Resolve the Bun executable — prefer system bun.
    private static func bunPath() -> String? {
        // Try to find bun in PATH
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/which")
        task.arguments = ["bun"]
        let outPipe = Pipe()
        task.standardOutput = outPipe
        try? task.run()
        task.waitUntilExit()
        let data = outPipe.fileHandleForReading.availableData
        if let path = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
           !path.isEmpty,
           FileManager.default.fileExists(atPath: path) {
            return path
        }
        return nil
    }

    /// Resolve the chat project root directory.
    private static func chatRoot() -> URL {
        let sourceDir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // Server/
            .deletingLastPathComponent() // Aidana/
            .deletingLastPathComponent() // project root
        return sourceDir.appendingPathComponent("chat", isDirectory: true)
    }

    /// Kill any process listening on the given port (used to free the chat port).
    nonisolated static func killProcessOnPort(_ port: Int) {
        let logger = Logger(subsystem: "de.aronhomberg.aidana", category: "ChatServer")
        // Use shell pipeline: lsof finds PIDs on port, xargs kills them
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/sh")
        task.arguments = ["-c", "lsof -ti :\(port) 2>/dev/null | xargs -r kill -9 2>/dev/null || true"]
        try? task.run()
        task.waitUntilExit()
        logger.info("Cleared port \(port)")
    }

    /// Kill any leftover Astro/bun processes from the chat directory.
    static func killStaleProcesses() {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
        task.arguments = ["-9", "-f", "chat/.*astro"]
        try? task.run()
        task.waitUntilExit()
    }

    /// Start the chat Astro dev server.
    func start(configuration: LaunchConfiguration) throws {
        guard !isRunning else {
            logger.warning("Chat server already running")
            return
        }

        let bun = Self.bunPath()
        guard let bun else {
            throw ChatErrors.bunNotFound
        }

        let chatRoot = Self.chatRoot()
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: bun)
        proc.currentDirectoryURL = chatRoot
        proc.arguments = ["run", "dev", "--port", "\(configuration.chatPort)"]
        proc.qualityOfService = .userInitiated

        // Set environment
        var environment = ProcessInfo.processInfo.environment
        environment["CHAT_PORT"] = "\(configuration.chatPort)"
        environment["NODE_ENV"] = "development"
        proc.environment = environment

        // Pipe stdout
        let outPipe = Pipe()
        proc.standardOutput = outPipe
        outPipe.fileHandleForReading.readabilityHandler = makeReadabilityHandler()

        // Pipe stderr
        let errPipe = Pipe()
        proc.standardError = errPipe
        errPipe.fileHandleForReading.readabilityHandler = makeReadabilityHandler()

        self.stdoutPipe = outPipe
        self.stderrPipe = errPipe

        proc.terminationHandler = { [weak self] _ in
            Task { await self?.markStopped() }
        }

        try proc.run()
        self.process = proc
        isRunning = true
        logger.info("Chat server process started on port \(configuration.chatPort), PID \(proc.processIdentifier)")
    }

    /// Wait until the server responds to HTTP health check, up to `timeout` seconds.
    func waitForReady(port: Int, timeout: TimeInterval = 30) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        let url = URL(string: "http://127.0.0.1:\(port)/")!

        while Date() < deadline {
            do {
                let (_, response) = try await URLSession.shared.data(from: url)
                if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                    return true
                }
            } catch {
                // Server not ready yet
            }
            try? await Task.sleep(nanoseconds: 500_000_000) // 0.5s
        }
        return false
    }

    /// Stop the Bun process.
    func stop() {
        guard let proc = process else { return }
        let pid = proc.processIdentifier
        logger.info("Stopping chat server (PID \(pid))")

        if proc.isRunning { proc.terminate() }

        DispatchQueue.global().asyncAfter(deadline: .now() + 2) {
            if proc.isRunning { kill(pid, SIGKILL) }
        }

        stdoutPipe?.fileHandleForReading.readabilityHandler = nil
        stderrPipe?.fileHandleForReading.readabilityHandler = nil
        process = nil
        stdoutPipe = nil
        stderrPipe = nil
        isRunning = false
    }

    func stopAndWait(timeout: TimeInterval = 5) async {
        stop()
        await waitUntilStopped(timeout: timeout)
    }

    func waitUntilStopped(timeout: TimeInterval = 5) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if !isRunning { return true }
            try? await Task.sleep(nanoseconds: 200_000_000) // 0.2s
        }
        return !isRunning
    }

    private func makeReadabilityHandler() -> @Sendable (FileHandle) -> Void {
        let log = onLog
        return { handle in
            let data = handle.availableData
            guard !data.isEmpty, let line = String(data: data, encoding: .utf8) else { return }
            for l in line.components(separatedBy: .newlines) where !l.isEmpty {
                log?("Chat: \(l)")
            }
        }
    }

    private func markStopped() {
        isRunning = false
        stdoutPipe?.fileHandleForReading.readabilityHandler = nil
        stderrPipe?.fileHandleForReading.readabilityHandler = nil
        logger.info("Chat server process exited")
    }

    enum ChatErrors: LocalizedError {
        case bunNotFound

        var errorDescription: String? {
            switch self {
            case .bunNotFound:
                return "Bun not found in PATH. Install Bun to run the chat server."
            }
        }
    }
}
