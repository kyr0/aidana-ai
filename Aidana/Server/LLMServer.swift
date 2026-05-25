//
//  LLMServer.swift
//  Aidana
//

import Foundation
import os

/// Manages the glitcr Python LLM proxy server as a subprocess.
actor LLMServer {
    private let logger = Logger(subsystem: "de.aronhomberg.aidana", category: "LLMServer")
    private var process: Process?
    private var stdoutPipe: Pipe?
    private var stderrPipe: Pipe?
    var onLog: (@Sendable (String) -> Void)?

    private(set) var isRunning = false

    struct LaunchConfiguration: Sendable {
        let endpoint: String
        let apiKey: String
        let model: String
        let proxyPort: Int
        let proxyAdminUser: String
        let proxyAdminPassword: String
    }

    func setLogCallback(_ callback: @escaping @Sendable (String) -> Void) {
        onLog = callback
    }

    /// Resolve the Python executable inside the glitcr .venv.
    private static func pythonPath() -> String {
        let sourceDir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // Server/
            .deletingLastPathComponent() // Aidana/
            .deletingLastPathComponent() // project root
        return sourceDir.appendingPathComponent("glitcr/.venv/bin/python").path
    }

    /// Resolve the glitcr project root directory.
    private static func glitcrRoot() -> URL {
        let sourceDir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // Server/
            .deletingLastPathComponent() // Aidana/
            .deletingLastPathComponent() // project root
        return sourceDir.appendingPathComponent("glitcr", isDirectory: true)
    }

    /// Resolve ~/.aidana/config.json URL.
    private static func configURL() -> URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".aidana", isDirectory: true)
            .appendingPathComponent("config.json")
    }

    /// Write config.json with llm + llm.proxy sections.
    private func writeConfig(configuration: LaunchConfiguration) throws {
        let url = Self.configURL()
        let directory = url.deletingLastPathComponent()

        if !FileManager.default.fileExists(atPath: directory.path) {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        }

        let dict: [String: Any] = [
            "llm": [
                "endpoint": configuration.endpoint,
                "apiKey": configuration.apiKey,
                "model": configuration.model,
                "proxy": [
                    "port": configuration.proxyPort,
                    "admin_user": configuration.proxyAdminUser,
                    "admin_password": configuration.proxyAdminPassword,
                    "autoStart": true
                ]
            ]
        ]

        let data = try JSONSerialization.data(withJSONObject: dict, options: .prettyPrinted)
        try data.write(to: url)
        logger.info("Wrote LLM config to \(url.path, privacy: .public)")
    }

    /// Write glitcr .env file from configuration.
    /// Merges with existing .env to preserve ADMIN_* hash fields from auth_create.
    private func writeEnvFile(configuration: LaunchConfiguration) throws {
        let glitcrRoot = Self.glitcrRoot()
        let envPath = glitcrRoot.appendingPathComponent(".env")

        // Read existing .env to preserve auth-derived fields
        var existing: [String: String] = [:]
        if let currentContent = try? String(contentsOf: envPath, encoding: .utf8) {
            for line in currentContent.components(separatedBy: .newlines) {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                guard !trimmed.isEmpty, !trimmed.hasPrefix("#"), trimmed.contains("=") else { continue }
                let parts = trimmed.split(separator: "=", maxSplits: 1)
                let key = String(parts[0]).trimmingCharacters(in: .whitespaces)
                var value = String(parts[1]).trimmingCharacters(in: .whitespaces)
                // Strip surrounding quotes
                if (value.hasPrefix("\"") && value.hasSuffix("\"")) || (value.hasPrefix("'") && value.hasSuffix("'")) {
                    value = String(value.dropFirst().dropLast())
                }
                existing[key] = value
            }
        }

        // Update with new config values (these override existing)
        existing["ADMIN_USER"] = configuration.proxyAdminUser
        existing["ADMIN_PASSWORD_PLAIN"] = configuration.proxyAdminPassword
        existing["GLITCR_HOST"] = "127.0.0.1"
        existing["GLITCR_PORT"] = "\(configuration.proxyPort)"
        if !configuration.apiKey.isEmpty {
            existing["OPENAI_API_KEY"] = configuration.apiKey
        }
        if !configuration.endpoint.isEmpty {
            existing["OPENAI_BASE_URL"] = configuration.endpoint
        }
        if !configuration.model.isEmpty {
            existing["TEST_MODEL_NAME"] = configuration.model
        }

        // Write merged .env
        let keysToWrite = [
            "ADMIN_USER", "ADMIN_PASSWORD", "ADMIN_SALT", "ADMIN_KDF_ITERATIONS",
            "ADMIN_PASSWORD_PLAIN", "GLITCR_HOST", "GLITCR_PORT",
            "OPENAI_API_KEY", "OPENAI_BASE_URL", "TEST_MODEL_NAME"
        ]
        var lines: [String] = []
        for key in keysToWrite {
            if let value = existing[key] {
                // Quote values that contain spaces or special chars
                if value.contains(" ") || value.contains("#") {
                    lines.append("\(key)=\"\(value)\"")
                } else {
                    lines.append("\(key)=\(value)")
                }
            }
        }

        let content = lines.joined(separator: "\n") + "\n"
        try content.write(to: envPath, atomically: true, encoding: .utf8)
        logger.info("Wrote glitcr .env to \(envPath.path, privacy: .public)")
    }

    /// Run glitcr auth create non-interactively.
    func runAuthCreate(configuration: LaunchConfiguration) throws {
        let python = Self.pythonPath()
        let glitcrRoot = Self.glitcrRoot()

        guard FileManager.default.fileExists(atPath: python) else {
            logger.warning("Python not found at \(python, privacy: .public) — skipping auth create")
            return
        }

        let task = Process()
        task.executableURL = URL(fileURLWithPath: python)
        task.currentDirectoryURL = glitcrRoot
        task.arguments = [
            "-m", "glitcr", "auth", "create",
            "--email", configuration.proxyAdminUser,
            "--password", configuration.proxyAdminPassword,
            "--force"
        ]

        let errPipe = Pipe()
        task.standardError = errPipe
        task.standardOutput = errPipe // capture both

        try task.run()
        task.waitUntilExit()

        let exitCode = task.terminationStatus
        if exitCode != 0 {
            let data = errPipe.fileHandleForReading.availableData
            if let output = String(data: data, encoding: .utf8) {
                logger.warning("glitcr auth create failed (exit \(exitCode)): \(output.trimmingCharacters(in: .whitespacesAndNewlines))")
            }
        } else {
            logger.info("glitcr auth create succeeded")
        }
    }

    /// Kill any leftover glitcr processes (e.g. from a previous crash).
    static func killStaleProcesses() {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
        task.arguments = ["-9", "-f", "glitcr"]
        try? task.run()
        task.waitUntilExit()
    }

    /// Start the glitcr proxy server.
    func start(configuration: LaunchConfiguration) throws {
        guard !isRunning else {
            logger.warning("LLM proxy already running")
            return
        }

        // Kill any orphaned glitcr from a previous run
        Self.killStaleProcesses()

        // Write config files
        try writeConfig(configuration: configuration)
        try writeEnvFile(configuration: configuration)

        // Run auth_create if .env doesn't have ADMIN_PASSWORD (first initialization)
        let envPath = Self.glitcrRoot().appendingPathComponent(".env")
        if let currentEnv = try? String(contentsOf: envPath, encoding: .utf8),
           !currentEnv.contains("ADMIN_PASSWORD=") {
            logger.info("ADMIN_PASSWORD not found in .env — running initial auth create")
            try runAuthCreate(configuration: configuration)
            // Re-write env to ensure all fields are present after auth_create
            try writeEnvFile(configuration: configuration)
        }

        let python = Self.pythonPath()
        guard FileManager.default.fileExists(atPath: python) else {
            throw LLMErrors.pythonNotFound(python)
        }

        let glitcrRoot = Self.glitcrRoot()
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: python)
        proc.currentDirectoryURL = glitcrRoot
        proc.arguments = [
            "-m", "glitcr", "serve",
            "--host", "127.0.0.1",
            "--port", "\(configuration.proxyPort)"
        ]
        proc.qualityOfService = .userInitiated

        // Pipe stdout
        let outPipe = Pipe()
        proc.standardOutput = outPipe
        let logFn = self.onLog
        outPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard !data.isEmpty, let line = String(data: data, encoding: .utf8) else { return }
            for l in line.components(separatedBy: .newlines) where !l.isEmpty {
                logFn?("LLM: \(l)")
            }
        }

        // Pipe stderr
        let errPipe = Pipe()
        proc.standardError = errPipe
        errPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard !data.isEmpty, let line = String(data: data, encoding: .utf8) else { return }
            for l in line.components(separatedBy: .newlines) where !l.isEmpty {
                logFn?("LLM: \(l)")
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
        logger.info("LLM proxy process started on port \(configuration.proxyPort), PID \(proc.processIdentifier)")
    }

    /// Wait until the server responds to HTTP health check, up to `timeout` seconds.
    func waitForReady(port: Int, timeout: TimeInterval = 30) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        let url = URL(string: "http://127.0.0.1:\(port)/health")!

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

    /// Stop the Python process and all its children.
    func stop() {
        guard let proc = process else { return }
        let pid = proc.processIdentifier
        logger.info("Stopping LLM proxy (PID \(pid))")

        if proc.isRunning { proc.terminate() }

        DispatchQueue.global().asyncAfter(deadline: .now() + 2) {
            if proc.isRunning { kill(pid, SIGKILL) }
        }

        Self.killStaleProcesses()

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

    private func markStopped() {
        isRunning = false
        stdoutPipe?.fileHandleForReading.readabilityHandler = nil
        stderrPipe?.fileHandleForReading.readabilityHandler = nil
        logger.info("LLM proxy process exited")
    }

    enum LLMErrors: LocalizedError {
        case pythonNotFound(String)
        case configWriteFailed(Error)

        var errorDescription: String? {
            switch self {
            case .pythonNotFound(let path):
                return "Python not found at \(path). Run 'make setup' in glitcr/ to create the virtual environment."
            case .configWriteFailed(let error):
                return "Failed to write LLM config: \(error.localizedDescription)"
            }
        }
    }
}
