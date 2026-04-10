//
//  TTSServer.swift
//  Aidana
//

import Foundation
import os

/// Manages the mlx_audio Python TTS server as a subprocess.
actor TTSServer {
    private let logger = Logger(subsystem: "de.aronhomberg.aidana", category: "TTSServer")
    private var process: Process?
    private var stdoutPipe: Pipe?
    private var stderrPipe: Pipe?
    var onLog: (@Sendable (String) -> Void)?

    private(set) var isRunning = false

    /// Resolve the Python executable inside the project's .venv.
    private static func pythonPath() -> String {
        let sourceDir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // Server/
            .deletingLastPathComponent() // Aidana/
            .deletingLastPathComponent() // project root
        return sourceDir.appendingPathComponent(".venv/bin/python").path
    }

    /// Resolve a writable log directory for mlx_audio.server.
    private static func logDirectory() -> URL {
        let fileManager = FileManager.default
        let preferredBase = fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/Aidana", isDirectory: true)
        let preferred = preferredBase.appendingPathComponent("mlx-audio", isDirectory: true)

        do {
            try fileManager.createDirectory(at: preferred, withIntermediateDirectories: true)
            return preferred
        } catch {
            let fallback = fileManager.temporaryDirectory
                .appendingPathComponent("Aidana", isDirectory: true)
                .appendingPathComponent("mlx-audio", isDirectory: true)
            try? fileManager.createDirectory(at: fallback, withIntermediateDirectories: true)
            return fallback
        }
    }

    func setLogCallback(_ callback: @escaping @Sendable (String) -> Void) {
        onLog = callback
    }

    /// Kill any leftover mlx_audio.server processes (e.g. from a previous crash).
    static func killStaleProcesses() {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
        task.arguments = ["-9", "-f", "mlx_audio.server"]
        try? task.run()
        task.waitUntilExit()
    }

    /// Start the mlx_audio server on the given port.
    func start(port: Int) throws {
        guard !isRunning else {
            logger.warning("TTS server already running")
            return
        }

        // Kill any orphaned TTS server from a previous run
        Self.killStaleProcesses()

        let python = Self.pythonPath()
        guard FileManager.default.fileExists(atPath: python) else {
            throw TTSError.pythonNotFound(python)
        }

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: python)
        let logDirectory = Self.logDirectory()
        proc.arguments = [
            "-m", "mlx_audio.server",
            "--host", "0.0.0.0",
            "--port", "\(port)",
            "--workers", "1",
            "--log-dir", logDirectory.path,
        ]
        // Create a new process group so we can kill all children
        proc.qualityOfService = .userInitiated
        proc.currentDirectoryURL = logDirectory.deletingLastPathComponent()

        // Pipe stdout
        let outPipe = Pipe()
        proc.standardOutput = outPipe
        let logFn = self.onLog
        outPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard !data.isEmpty, let line = String(data: data, encoding: .utf8) else { return }
            for l in line.components(separatedBy: .newlines) where !l.isEmpty {
                logFn?("TTS: \(l)")
            }
        }

        // Pipe stderr
        let errPipe = Pipe()
        proc.standardError = errPipe
        errPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard !data.isEmpty, let line = String(data: data, encoding: .utf8) else { return }
            for l in line.components(separatedBy: .newlines) where !l.isEmpty {
                logFn?("TTS: \(l)")
            }
        }

        self.stdoutPipe = outPipe
        self.stderrPipe = errPipe

        proc.terminationHandler = { [weak self] _ in
            Task { await self?.markStopped() }
        }

        try proc.run()
        self.process = proc
        isRunning = true
        logger.info("TTS server process started on port \(port), PID \(proc.processIdentifier), logs at \(logDirectory.path, privacy: .public)")
    }

    /// Wait until the server responds to HTTP, up to `timeout` seconds.
    func waitForReady(port: Int, timeout: TimeInterval = 60) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        let url = URL(string: "http://localhost:\(port)/v1/models")!

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

    /// Tell the server to eagerly load a TTS model.
    func preloadModel(_ modelName: String, port: Int) async throws {
        let encoded = modelName.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? modelName
        let url = URL(string: "http://localhost:\(port)/v1/models?model_name=\(encoded)")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 300 // model download + load can take minutes
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw TTSError.preloadFailed(modelName)
        }
        logger.info("TTS model preloaded: \(modelName)")
    }

    /// Stop the Python process and all its children.
    func stop() {
        guard let proc = process else { return }
        let pid = proc.processIdentifier
        logger.info("Stopping TTS server (PID \(pid))")

        // SIGTERM first for graceful shutdown
        if proc.isRunning { proc.terminate() }

        // Force kill after 2 seconds if still alive
        DispatchQueue.global().asyncAfter(deadline: .now() + 2) {
            if proc.isRunning { kill(pid, SIGKILL) }
        }

        // pkill as safety net — catches uvicorn workers too
        Self.killStaleProcesses()

        stdoutPipe?.fileHandleForReading.readabilityHandler = nil
        stderrPipe?.fileHandleForReading.readabilityHandler = nil
        process = nil
        stdoutPipe = nil
        stderrPipe = nil
        isRunning = false
    }

    private func markStopped() {
        isRunning = false
        stdoutPipe?.fileHandleForReading.readabilityHandler = nil
        stderrPipe?.fileHandleForReading.readabilityHandler = nil
        logger.info("TTS server process exited")
    }

    enum TTSError: LocalizedError {
        case pythonNotFound(String)
        case preloadFailed(String)

        var errorDescription: String? {
            switch self {
            case .pythonNotFound(let path):
                return "Python not found at \(path). Run 'make setup' to create the virtual environment."
            case .preloadFailed(let model):
                return "Failed to preload TTS model: \(model)"
            }
        }
    }
}
