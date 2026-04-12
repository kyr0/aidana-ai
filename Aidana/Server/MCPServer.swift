//
//  MCPServer.swift
//  Aidana
//

import Foundation
import os

actor MCPServer {
    enum RuntimeKind: String, Sendable {
        case node
        case bun
    }

    enum LifecycleEvent: Sendable {
        case stopped(expected: Bool, exitCode: Int32)
    }

    struct LaunchConfiguration: Sendable {
        let mcpPort: Int
        let workQueuePort: Int
        let workspacePath: String
    }

    enum MCPError: LocalizedError {
        case embeddedBundleMissing(String)
        case runtimeMissing(URL)
        case scriptMissing(URL)

        var errorDescription: String? {
            switch self {
            case .embeddedBundleMissing(let path):
                return "Embedded MCP bundle missing at \(path). Build the app again so the MCP runtime is copied into Aidana.app."
            case .runtimeMissing(let root):
                return "No embedded Node or Bun runtime found under \(root.path)."
            case .scriptMissing(let url):
                return "Embedded MCP script missing at \(url.path)."
            }
        }
    }

    private let logger = Logger(subsystem: "de.aronhomberg.aidana", category: "MCPServer")
    private var process: Process?
    private var stdoutPipe: Pipe?
    private var stderrPipe: Pipe?
    private var shutdownRequested = false
    var onLog: (@Sendable (String) -> Void)?
    var onLifecycleEvent: (@Sendable (LifecycleEvent) -> Void)?

    private(set) var isRunning = false

    func setLogCallback(_ callback: @escaping @Sendable (String) -> Void) {
        onLog = callback
    }

    func setLifecycleCallback(_ callback: @escaping @Sendable (LifecycleEvent) -> Void) {
        onLifecycleEvent = callback
    }

    static func killStaleProcesses() {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
        task.arguments = ["-f", "mcp-server.cjs"]
        try? task.run()
        task.waitUntilExit()
    }

    func start(configuration: LaunchConfiguration) throws {
        guard !isRunning else {
            logger.warning("MCP server already running")
            return
        }

        Self.killStaleProcesses()

        let artifacts = try resolveLaunchArtifacts()
        let proc = Process()
        proc.executableURL = artifacts.runtimeURL
        proc.arguments = [artifacts.scriptURL.path]
        proc.currentDirectoryURL = artifacts.rootURL
        proc.qualityOfService = .userInitiated

        var environment = ProcessInfo.processInfo.environment
        environment["AIDANA_MCP_TRANSPORT"] = "http"
        environment["AIDANA_MCP_HOST"] = "127.0.0.1"
        environment["AIDANA_MCP_PORT"] = "\(configuration.mcpPort)"
        environment["AIDANA_WORK_QUEUE_PORT"] = "\(configuration.workQueuePort)"
        environment["AIDANA_WORKSPACE_PATH"] = configuration.workspacePath
        proc.environment = environment

        let outPipe = Pipe()
        proc.standardOutput = outPipe
        outPipe.fileHandleForReading.readabilityHandler = makeReadabilityHandler()

        let errPipe = Pipe()
        proc.standardError = errPipe
        errPipe.fileHandleForReading.readabilityHandler = makeReadabilityHandler()

        stdoutPipe = outPipe
        stderrPipe = errPipe
        shutdownRequested = false

        proc.terminationHandler = { [weak self] process in
            Task {
                await self?.markStopped(exitCode: process.terminationStatus)
            }
        }

        try proc.run()
        process = proc
        isRunning = true

        let log = onLog
        log?("MCP: launched embedded \(artifacts.runtimeKind.rawValue) runtime (PID \(proc.processIdentifier))")
        logger.info("MCP server started with PID \(proc.processIdentifier)")
    }

    func waitForReady(port: Int, timeout: TimeInterval = 30) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        let url = URL(string: "http://127.0.0.1:\(port)/healthz")!

        while Date() < deadline {
            do {
                let (_, response) = try await URLSession.shared.data(from: url)
                if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                    return true
                }
            } catch {
                // Server is not ready yet.
            }

            try? await Task.sleep(nanoseconds: 500_000_000)
        }

        return false
    }

    func stop() {
        guard let proc = process else { return }
        shutdownRequested = true

        logger.info("Stopping MCP server (PID \(proc.processIdentifier))")
        if proc.isRunning {
            proc.terminate()
        }

        DispatchQueue.global().asyncAfter(deadline: .now() + 2) {
            if proc.isRunning {
                kill(proc.processIdentifier, SIGKILL)
            }
        }
    }

    private func resolveLaunchArtifacts() throws -> (rootURL: URL, runtimeURL: URL, scriptURL: URL, runtimeKind: RuntimeKind) {
        guard let rootURL = Bundle.main.resourceURL?.appendingPathComponent("EmbeddedMCP", isDirectory: true),
              FileManager.default.fileExists(atPath: rootURL.path) else {
            throw MCPError.embeddedBundleMissing(
                Bundle.main.resourceURL?
                    .appendingPathComponent("EmbeddedMCP", isDirectory: true)
                    .path ?? "EmbeddedMCP"
            )
        }

        let scriptURL = rootURL.appendingPathComponent("mcp-server.cjs")
        guard FileManager.default.fileExists(atPath: scriptURL.path) else {
            throw MCPError.scriptMissing(scriptURL)
        }

        let nodeURL = rootURL
            .appendingPathComponent("runtime", isDirectory: true)
            .appendingPathComponent("bin", isDirectory: true)
            .appendingPathComponent("node")

        if FileManager.default.fileExists(atPath: nodeURL.path) {
            return (rootURL, nodeURL, scriptURL, .node)
        }

        let bunURL = rootURL
            .appendingPathComponent("runtime", isDirectory: true)
            .appendingPathComponent("bin", isDirectory: true)
            .appendingPathComponent("bun")

        if FileManager.default.fileExists(atPath: bunURL.path) {
            return (rootURL, bunURL, scriptURL, .bun)
        }

        throw MCPError.runtimeMissing(rootURL)
    }

    private func makeReadabilityHandler() -> @Sendable (FileHandle) -> Void {
        let log = onLog
        return { handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }

            for line in text.components(separatedBy: .newlines) where !line.isEmpty {
                log?(line.hasPrefix("MCP:") ? line : "MCP: \(line)")
            }
        }
    }

    private func markStopped(exitCode: Int32) {
        let expected = shutdownRequested
        shutdownRequested = false
        isRunning = false
        stdoutPipe?.fileHandleForReading.readabilityHandler = nil
        stderrPipe?.fileHandleForReading.readabilityHandler = nil
        stdoutPipe = nil
        stderrPipe = nil
        process = nil

        logger.info("MCP server exited with status \(exitCode)")
        onLifecycleEvent?(.stopped(expected: expected, exitCode: exitCode))
    }
}