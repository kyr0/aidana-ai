//
//  ServerState.swift
//  Aidana
//

import Combine
import Foundation

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
    }

    @Published private(set) var status: Status = .stopped
    @Published private(set) var asrModelReady = false
    @Published private(set) var ttsReady = false
    @Published private(set) var ttsStatus: TTSStatus = .stopped
    @Published private(set) var mcpStatus: MCPStatus = .stopped
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

    func setConnectedASRClients(_ count: Int) {
        connectedASRClients = count
    }

    func setListeningMode(_ mode: ListeningMode) {
        listeningMode = mode
    }
}
