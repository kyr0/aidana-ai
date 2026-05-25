//
//  ServerState.swift
//  Aidana
//

import Combine
import Foundation

struct RuntimeServiceStatusSnapshot: Codable, Sendable {
    let state: String
    let displayText: String
    let ready: Bool
    let healthy: Bool
    let port: Int?
    let autoStart: Bool?
}

struct RuntimeStatusSnapshot: Codable, Sendable {
    let status: String
    let allHealthy: Bool
    let asr: RuntimeServiceStatusSnapshot
    let tts: RuntimeServiceStatusSnapshot
    let mcp: RuntimeServiceStatusSnapshot

    enum CodingKeys: String, CodingKey {
        case status
        case allHealthy = "all_healthy"
        case asr
        case tts
        case mcp
    }
}

@MainActor
final class ServerState: ObservableObject {
    enum Status: Equatable {
        case stopped
        case starting
        case running(port: Int)
        case downloading(progress: Double?)
        case loading
        case error(String)

        var isRunning: Bool {
            if case .running = self { return true }
            return false
        }

        var displayText: String {
            switch self {
            case .stopped:
                return "Stopped"
            case .starting:
                return "Starting…"
            case .running(let port):
                return "Running on \(port)"
            case .downloading(let progress):
                if let progress {
                    return "Downloading… \(Int(progress * 100))%"
                }
                return "Downloading…"
            case .loading:
                return "Loading…"
            case .error(let message):
                return "Error: \(message)"
            }
        }

        var stateKey: String {
            switch self {
            case .stopped:
                return "stopped"
            case .starting:
                return "starting"
            case .running:
                return "running"
            case .downloading:
                return "downloading"
            case .loading:
                return "loading"
            case .error:
                return "error"
            }
        }
    }

    enum ListeningMode: String, Equatable {
        case idle
        case active
    }

    enum MenuIcon: String {
        case stopped = "MenuBarIdle"
        case idleListening = "MenuBarTranscribing"   // yellow/orange
        case activeListening = "MenuBarListening"     // red/active

        static func from(status: Status, listeningMode: ListeningMode) -> MenuIcon {
            switch status {
            case .stopped, .error:
                return .stopped
            case .starting, .downloading, .loading:
                return .idleListening
            case .running:
                return listeningMode == .active ? .activeListening : .idleListening
            }
        }
    }

    enum TTSStatus: Equatable {
        case stopped
        case starting
        case downloading(progress: Int?)
        case loading
        case ready(port: Int)
        case error(String)

        var displayText: String {
            switch self {
            case .stopped: return "Stopped"
            case .starting: return "Starting…"
            case .downloading(let pct):
                if let pct { return "Downloading… \(pct)%" }
                return "Downloading…"
            case .loading: return "Loading model…"
            case .ready(let port): return "Running on \(port)"
            case .error(let msg): return "Error: \(msg)"
            }
        }

        var stateKey: String {
            switch self {
            case .stopped:
                return "stopped"
            case .starting:
                return "starting"
            case .downloading:
                return "downloading"
            case .loading:
                return "loading"
            case .ready:
                return "ready"
            case .error:
                return "error"
            }
        }

        var isReady: Bool {
            if case .ready = self { return true }
            return false
        }
    }

    enum MCPStatus: Equatable {
        case stopped
        case starting
        case ready(port: Int)
        case error(String)

        var displayText: String {
            switch self {
            case .stopped: return "Stopped"
            case .starting: return "Starting…"
            case .ready(let port): return "Running on \(port)"
            case .error(let message): return "Error: \(message)"
            }
        }

        var stateKey: String {
            switch self {
            case .stopped:
                return "stopped"
            case .starting:
                return "starting"
            case .ready:
                return "ready"
            case .error:
                return "error"
            }
        }

        var isReady: Bool {
            if case .ready = self { return true }
            return false
        }
    }

    enum LLMStatus: Equatable {
        case stopped
        case starting
        case ready(port: Int)
        case error(String)

        var displayText: String {
            switch self {
            case .stopped: return "Stopped"
            case .starting: return "Starting…"
            case .ready(let port): return "Running on \(port)"
            case .error(let message): return "Error: \(message)"
            }
        }

        var stateKey: String {
            switch self {
            case .stopped: return "stopped"
            case .starting: return "starting"
            case .ready: return "ready"
            case .error: return "error"
            }
        }

        var isReady: Bool {
            if case .ready = self { return true }
            return false
        }
    }

    @Published private(set) var status: Status = .stopped
    @Published private(set) var asrModelReady = false
    @Published private(set) var ttsReady = false
    @Published private(set) var ttsStatus: TTSStatus = .stopped
    @Published private(set) var mcpStatus: MCPStatus = .stopped
    @Published private(set) var llmStatus: LLMStatus = .stopped
    @Published private(set) var connectedASRClients = 0
    @Published private(set) var listeningMode: ListeningMode = .idle

    func setStatus(_ newStatus: Status) {
        status = newStatus
    }

    func setASRModelReady(_ ready: Bool) {
        asrModelReady = ready
    }

    func setTTSReady(_ ready: Bool, port: Int = 0) {
        ttsReady = ready
        if ready { ttsStatus = .ready(port: port) }
    }

    func setTTSStatus(_ newStatus: TTSStatus) {
        ttsStatus = newStatus
    }

    func setMCPStatus(_ newStatus: MCPStatus) {
        mcpStatus = newStatus
    }

    func setLLMStatus(_ newStatus: LLMStatus) {
        llmStatus = newStatus
    }

    func setConnectedASRClients(_ count: Int) {
        connectedASRClients = count
    }

    func setListeningMode(_ mode: ListeningMode) {
        listeningMode = mode
    }

    func runtimeStatusSnapshot(
        asrPort: Int,
        ttsPort: Int,
        mcpPort: Int,
        mcpAutoStart: Bool
    ) -> RuntimeStatusSnapshot {
        let asrHealthy = asrModelReady && status.isRunning
        let ttsHealthy = ttsReady && ttsStatus.isReady
        let mcpHealthy = mcpStatus.isReady

        let asr = RuntimeServiceStatusSnapshot(
            state: status.stateKey,
            displayText: status.displayText,
            ready: asrHealthy,
            healthy: asrHealthy,
            port: asrPort,
            autoStart: nil
        )

        let tts = RuntimeServiceStatusSnapshot(
            state: ttsStatus.stateKey,
            displayText: ttsStatus.displayText,
            ready: ttsHealthy,
            healthy: ttsHealthy,
            port: ttsPort,
            autoStart: nil
        )

        let mcp = RuntimeServiceStatusSnapshot(
            state: mcpStatus.stateKey,
            displayText: mcpStatus.displayText,
            ready: mcpHealthy,
            healthy: mcpHealthy,
            port: mcpPort,
            autoStart: mcpAutoStart
        )

        return RuntimeStatusSnapshot(
            status: "ok",
            allHealthy: asr.healthy && tts.healthy && mcp.healthy,
            asr: asr,
            tts: tts,
            mcp: mcp
        )
    }
}
