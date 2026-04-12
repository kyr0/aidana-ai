//
//  MCPServer.swift
//  Aidana
//

import Foundation
import os

actor MCPServer {
    static let defaultTransport = "http"
    static let defaultHost = "127.0.0.1"
    static let defaultPath = "/mcp"
    static let defaultHealthPath = "/healthz"
    static let defaultWorkQueuePort = 3210

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

    private struct ClientConfigurationFile: Encodable {
        let servers: [String: ClientConfigurationEntry]
        let mcpServers: [String: ClientConfigurationEntry]
    }

    private struct ClientConfigurationEntry: Encodable {
        let type: String
        let url: URL
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
    private let mcpTransport = MCPServer.defaultTransport
    private let mcpHost = MCPServer.defaultHost
    private let mcpPath = MCPServer.defaultPath
    private let defaultClientConfigDirectoryName = ".aidana"
    private let defaultClientConfigFileName = "mcp.json"
    private let defaultClientConfigServerName = "aidana"
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
        environment["AIDANA_MCP_TRANSPORT"] = mcpTransport
        environment["AIDANA_MCP_HOST"] = mcpHost
        environment["AIDANA_MCP_PORT"] = "\(configuration.mcpPort)"
        environment["AIDANA_MCP_PATH"] = mcpPath
        environment["AIDANA_MCP_HEALTH_PATH"] = Self.defaultHealthPath
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

        prepareDefaultClientConfigurationIfNeeded(configuration: configuration)

        let log = onLog
        log?("MCP: launched embedded \(artifacts.runtimeKind.rawValue) runtime (PID \(proc.processIdentifier))")
        logger.info("MCP server started with PID \(proc.processIdentifier)")
    }

    func waitForReady(port: Int, timeout: TimeInterval = 30) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        let url = URL(string: "\(Self.defaultTransport)://\(Self.defaultHost):\(port)\(Self.defaultHealthPath)")!

        while !Task.isCancelled && Date() < deadline {
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

    func stopAndWait(timeout: TimeInterval = 5) async {
        stop()
        _ = await waitUntilStopped(timeout: timeout)
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

    func waitUntilStopped(timeout: TimeInterval = 5) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)

        while isRunning && Date() < deadline {
            try? await Task.sleep(nanoseconds: 100_000_000)
        }

        return !isRunning
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

    private func prepareDefaultClientConfigurationIfNeeded(configuration: LaunchConfiguration) {
        let fileManager = FileManager.default
        let configDirectoryURL = defaultClientConfigDirectoryURL(fileManager: fileManager)
        let configURL = configDirectoryURL.appendingPathComponent(defaultClientConfigFileName)

        do {
            try fileManager.createDirectory(
                at: configDirectoryURL,
                withIntermediateDirectories: true
            )

            var isDirectory = ObjCBool(false)
            if fileManager.fileExists(atPath: configURL.path, isDirectory: &isDirectory) {
                if isDirectory.boolValue {
                    throw NSError(
                        domain: NSPOSIXErrorDomain,
                        code: Int(EISDIR),
                        userInfo: [
                            NSFilePathErrorKey: configURL.path,
                            NSLocalizedDescriptionKey: "Expected a file at \(configURL.path), but found a directory.",
                        ]
                    )
                }

                return
            }

            let entry = ClientConfigurationEntry(
                type: mcpTransport,
                url: mcpEndpointURL(port: configuration.mcpPort)
            )
            let config = ClientConfigurationFile(
                servers: [defaultClientConfigServerName: entry],
                mcpServers: [defaultClientConfigServerName: entry]
            )

            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]

            var data = try encoder.encode(config)
            data.append(0x0A)

            try data.write(to: configURL, options: .atomic)
            onLog?("MCP: wrote default client config to \(configURL.path)")
        } catch {
            logger.error("Failed to prepare default MCP client config: \(error.localizedDescription, privacy: .public)")
            onLog?("MCP: failed to prepare default client config at \(configURL.path): \(error.localizedDescription)")
        }
    }

    private func defaultClientConfigDirectoryURL(fileManager: FileManager) -> URL {
        fileManager.homeDirectoryForCurrentUser.appendingPathComponent(
            defaultClientConfigDirectoryName,
            isDirectory: true
        )
    }

    private func mcpEndpointURL(port: Int) -> URL {
        var components = URLComponents()
        components.scheme = mcpTransport
        components.host = mcpHost
        components.port = port
        components.path = mcpPath

        guard let url = components.url else {
            preconditionFailure("Invalid MCP endpoint components")
        }

        return url
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