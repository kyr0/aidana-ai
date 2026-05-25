//
//  StatusBarController.swift
//  Aidana
//

import AppKit
import Combine
import QuartzCore

@MainActor
final class StatusBarController {
    private let statusItem: NSStatusItem
    private let menu = NSMenu()
    private let asrInfoItem = NSMenuItem(title: "ASR: Stopped", action: nil, keyEquivalent: "")
    private let ttsInfoItem = NSMenuItem(title: "TTS: Stopped", action: nil, keyEquivalent: "")
    private let mcpInfoItem = NSMenuItem(title: "MCP: Stopped", action: nil, keyEquivalent: "")
    private let llmInfoItem = NSMenuItem(title: "LLM: Stopped", action: nil, keyEquivalent: "")
    private let openChatItem = NSMenuItem(title: "Open Chat…", action: #selector(handleOpenChat), keyEquivalent: "")
    private let openLlmAdminItem = NSMenuItem(title: "Open LLM Proxy Admin…", action: #selector(handleOpenLlmAdmin), keyEquivalent: "")
    private let logItem = NSMenuItem(title: "Log…", action: #selector(handleLogRequest), keyEquivalent: "l")
    private let preferencesItem = NSMenuItem(title: "Preferences…", action: #selector(handlePreferencesRequest), keyEquivalent: ",")
    private let quitItem = NSMenuItem(title: "Quit Aidana", action: #selector(handleQuit), keyEquivalent: "q")
    private var cancellables = Set<AnyCancellable>()
    private let serverState: ServerState
    private let preferences: PreferencesStore
    private let quitAction: () -> Void

    init(serverState: ServerState, preferences: PreferencesStore, quitAction: @escaping () -> Void) {
        self.serverState = serverState
        self.preferences = preferences
        self.quitAction = quitAction
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)

        if let button = statusItem.button {
            button.wantsLayer = true
            button.layer?.masksToBounds = false
        }

        configureMenu()
        observeState()
        update(for: serverState.status)
    }

    private func configureMenu() {
        logItem.target = self
        preferencesItem.target = self
        quitItem.target = self
        openChatItem.target = self
        openLlmAdminItem.target = self
        asrInfoItem.isEnabled = false
        ttsInfoItem.isEnabled = false
        mcpInfoItem.isEnabled = false
        llmInfoItem.isEnabled = false

        menu.items = [
            asrInfoItem,
            ttsInfoItem,
            mcpInfoItem,
            llmInfoItem,
            NSMenuItem.separator(),
            openChatItem,
            openLlmAdminItem,
            NSMenuItem.separator(),
            logItem,
            preferencesItem,
            NSMenuItem.separator(),
            quitItem
        ]
        statusItem.menu = menu
    }

    private func observeState() {
        serverState.$status
            .receive(on: RunLoop.main)
            .sink { [weak self] status in
                self?.update(for: status)
                self?.asrInfoItem.title = "ASR: \(status.displayText)"
            }
            .store(in: &cancellables)

        serverState.$listeningMode
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                guard let self else { return }
                self.update(for: self.serverState.status)
            }
            .store(in: &cancellables)

        serverState.$ttsStatus
            .receive(on: RunLoop.main)
            .sink { [weak self] status in
                self?.ttsInfoItem.title = "TTS: \(status.displayText)"
            }
            .store(in: &cancellables)

        serverState.$mcpStatus
            .receive(on: RunLoop.main)
            .sink { [weak self] status in
                self?.mcpInfoItem.title = "MCP: \(status.displayText)"
            }
            .store(in: &cancellables)

        serverState.$llmStatus
            .receive(on: RunLoop.main)
            .sink { [weak self] status in
                self?.llmInfoItem.title = "LLM: \(status.displayText)"
            }
            .store(in: &cancellables)
    }

    private func updateButtonAnimation(for status: ServerState.Status) {
        guard let button = statusItem.button else { return }
        stopAllAnimations(on: button)

        switch status {
        case .running:
            startRunningAnimation(on: button)
        case .downloading, .starting:
            startDownloadingAnimation(on: button)
        default:
            break
        }
    }

    private func startRunningAnimation(on button: NSStatusBarButton) {
        guard let layer = button.layer else { return }
        let breath = CABasicAnimation(keyPath: "opacity")
        breath.fromValue = 1.0
        breath.toValue = 0.7
        breath.duration = 2.0
        breath.autoreverses = true
        breath.repeatCount = .infinity
        breath.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        layer.add(breath, forKey: "runningBreath")
    }

    private func startDownloadingAnimation(on button: NSStatusBarButton) {
        guard let layer = button.layer else { return }
        let pulse = CABasicAnimation(keyPath: "opacity")
        pulse.fromValue = 1.0
        pulse.toValue = 0.4
        pulse.duration = 0.8
        pulse.autoreverses = true
        pulse.repeatCount = .infinity
        pulse.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        layer.add(pulse, forKey: "downloadingPulse")
    }

    private func stopAllAnimations(on button: NSStatusBarButton) {
        guard let layer = button.layer else { return }
        layer.removeAllAnimations()
        layer.opacity = 1.0
    }

    private func update(for status: ServerState.Status) {
        let iconName = ServerState.MenuIcon.from(status: status, listeningMode: serverState.listeningMode).rawValue
        if let image = NSImage(named: iconName) {
            image.isTemplate = false
            statusItem.button?.image = image
        }
        updateButtonAnimation(for: status)
    }

    @objc private func handleLogRequest() {
        NotificationCenter.default.post(name: .statusBarLogRequested, object: nil)
    }

    @objc private func handlePreferencesRequest() {
        NotificationCenter.default.post(name: .statusBarPreferencesRequested, object: nil)
    }

    @objc private func handleOpenChat() {
        NotificationCenter.default.post(name: .openChatRequested, object: nil)
    }

    @objc private func handleOpenLlmAdmin() {
        NotificationCenter.default.post(name: .openLlmAdminRequested, object: nil)
    }

    @objc private func handleQuit() {
        quitAction()
    }
}

extension Notification.Name {
    static let statusBarLogRequested = Notification.Name("com.aidana.statusBarLogRequested")
    static let statusBarPreferencesRequested = Notification.Name("com.aidana.statusBarPreferencesRequested")
    static let mcpStartRequested = Notification.Name("com.aidana.mcpStartRequested")
    static let mcpStopRequested = Notification.Name("com.aidana.mcpStopRequested")
    static let mcpRestartRequested = Notification.Name("com.aidana.mcpRestartRequested")
    static let llmStartRequested = Notification.Name("com.aidana.llmStartRequested")
    static let llmStopRequested = Notification.Name("com.aidana.llmStopRequested")
    static let llmRestartRequested = Notification.Name("com.aidana.llmRestartRequested")
    static let llmUpdateRequested = Notification.Name("com.aidana.llmUpdateRequested")
    static let openChatRequested = Notification.Name("com.aidana.openChatRequested")
    static let openLlmAdminRequested = Notification.Name("com.aidana.openLlmAdminRequested")
}
