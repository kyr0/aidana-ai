//
//  LogView.swift
//  Aidana
//

import AppKit
import SwiftUI

private enum LogTab: String, CaseIterable {
    case asr = "ASR"
    case tts = "TTS"
    case mcp = "MCP"
    case llm = "LLM"
    case chat = "Chat"
}

struct LogView: View {
    @EnvironmentObject private var asrLogStore: LogStore
    @EnvironmentObject private var ttsLogStore: TTSLogStore
    @EnvironmentObject private var mcpLogStore: MCPLogStore
    @EnvironmentObject private var llmLogStore: LLMLogStore
    @EnvironmentObject private var chatLogStore: ChatLogStore
    @EnvironmentObject private var serverState: ServerState
    @EnvironmentObject private var testClient: ASRTestClient
    @EnvironmentObject private var preferences: PreferencesStore
    @State private var selectedTab: LogTab = .asr

    var body: some View {
        VStack(spacing: 0) {
            Picker("", selection: $selectedTab) {
                ForEach(LogTab.allCases, id: \.self) { tab in
                    Text(tab.rawValue)
                        .tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.top, 4)

            Divider()

            switch selectedTab {
            case .asr:
                ASRLogTab()
                    .environmentObject(asrLogStore)
                    .environmentObject(serverState)
                    .environmentObject(testClient)
            case .tts:
                TTSLogTab()
                    .environmentObject(ttsLogStore)
            case .mcp:
                MCPLogTab()
                    .environmentObject(mcpLogStore)
            case .llm:
                LLMLogTab()
                    .environmentObject(llmLogStore)
            case .chat:
                ChatLogTab()
                    .environmentObject(chatLogStore)
            }
        }
    }
}

// MARK: - ASR Log Tab

private struct ASRLogTab: View {
    @EnvironmentObject private var logStore: LogStore
    @EnvironmentObject private var serverState: ServerState
    @EnvironmentObject private var testClient: ASRTestClient

    var body: some View {
        VStack(spacing: 0) {
            LogPanelView(entries: logStore.entries)

            Divider()

            HStack {
                Text("\(logStore.entries.count) entries")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Spacer()
                if testClient.isRunning {
                    Button("Cancel Test") {
                        testClient.cancel()
                    }
                    .buttonStyle(.borderless)
                    .font(.caption)
                } else {
                    Button("Direct Test") {
                        if let mm = testClient.modelManager {
                            testClient.runDirectTest(modelManager: mm)
                        }
                    }
                    .buttonStyle(.borderless)
                    .font(.caption)
                    .disabled(!serverState.asrModelReady)
                    Button("WS Test") {
                        if case .running(let port) = serverState.status {
                            testClient.runTest(port: port)
                        }
                    }
                    .buttonStyle(.borderless)
                    .font(.caption)
                    .disabled(!serverState.status.isRunning)
                }
                Button("Copy") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(logText(logStore.entries), forType: .string)
                }
                .buttonStyle(.borderless)
                .font(.caption)
                Button("Clear") {
                    logStore.clear()
                }
                .buttonStyle(.borderless)
                .font(.caption)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
        }
    }
}

// MARK: - TTS Log Tab

private struct TTSLogTab: View {
    @EnvironmentObject private var logStore: TTSLogStore

    var body: some View {
        VStack(spacing: 0) {
            LogPanelView(entries: logStore.entries)

            Divider()

            HStack {
                Text("\(logStore.entries.count) entries")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Spacer()
                Button("Copy") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(logText(logStore.entries), forType: .string)
                }
                .buttonStyle(.borderless)
                .font(.caption)
                Button("Clear") {
                    logStore.clear()
                }
                .buttonStyle(.borderless)
                .font(.caption)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
        }
    }
}

// MARK: - MCP Log Tab

private enum MCPSubTab: String, CaseIterable {
    case logs
    case tools
}

private struct MCPLogTab: View {
    @EnvironmentObject private var logStore: MCPLogStore
    @EnvironmentObject private var serverState: ServerState
    @StateObject private var toolsViewModel = MCPToolsViewModel()
    @State private var selectedSubTab: MCPSubTab = .logs

    var body: some View {
        VStack(spacing: 0) {
            // Content area
            switch selectedSubTab {
            case .logs:
                VStack(spacing: 0) {
                    LogPanelView(entries: logStore.entries)

                    Divider()

                    HStack {
                        Text("\(logStore.entries.count) entries")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        Spacer()
                        Button("Copy") {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(logText(logStore.entries), forType: .string)
                        }
                        .buttonStyle(.borderless)
                        .font(.caption)
                        Button("Clear") {
                            logStore.clear()
                        }
                        .buttonStyle(.borderless)
                        .font(.caption)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                }
            case .tools:
                MCPToolsTabView(viewModel: toolsViewModel)
                    .onAppear {
                        if case .ready(let port) = serverState.mcpStatus {
                            toolsViewModel.fetchTools(port: port)
                        }
                    }
            }

            // Bottom tab bar
            Divider()
            Picker("", selection: $selectedSubTab) {
                ForEach(MCPSubTab.allCases, id: \.self) { tab in
                    switch tab {
                    case .logs:
                        Label("Logs", systemImage: "text.rightaligned.on.text")
                            .tag(tab)
                    case .tools:
                        Label("Tools", systemImage: "wrench.and.screwdriver")
                            .tag(tab)
                    }
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
        }
        .onChange(of: serverState.mcpStatus) { _, newStatus in
            if case .ready(let port) = newStatus {
                toolsViewModel.fetchTools(port: port)
            }
        }
    }
}

// MARK: - LLM Log Tab

private struct LLMLogTab: View {
    @EnvironmentObject private var logStore: LLMLogStore
    @EnvironmentObject private var preferences: PreferencesStore

    var body: some View {
        VStack(spacing: 0) {
            LogPanelView(entries: logStore.entries)

            Divider()

            HStack {
                Text("\(logStore.entries.count) entries")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Spacer()
                Button("Open Admin Panel") {
                    let adminURL = URL(string: "http://127.0.0.1:\(preferences.llmProxyPort)")!
                    NSWorkspace.shared.open(adminURL)
                }
                .buttonStyle(.borderless)
                .font(.caption)
                .help("Open the glitcr admin panel in your browser")
                Button("Copy") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(logText(logStore.entries), forType: .string)
                }
                .buttonStyle(.borderless)
                .font(.caption)
                Button("Clear") {
                    logStore.clear()
                }
                .buttonStyle(.borderless)
                .font(.caption)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
        }
    }
}

// MARK: - MCP Tools Tab

private struct MCPToolsTabView: View {
    @ObservedObject var viewModel: MCPToolsViewModel
    @EnvironmentObject private var serverState: ServerState

    var body: some View {
        VStack(spacing: 0) {
            if viewModel.isLoading {
                ContentUnavailableView(
                    "Loading Tools",
                    systemImage: "arrow.clockwise",
                    description: Text("Fetching available tools from MCP server…")
                )
            } else if let errorMessage = viewModel.errorMessage {
                ContentUnavailableView(
                    "Error Loading Tools",
                    systemImage: "exclamationmark.triangle",
                    description: Text(errorMessage)
                )
            } else if viewModel.tools.isEmpty {
                ContentUnavailableView(
                    "No Tools",
                    systemImage: "wrench.and.screwdriver",
                    description: Text("No tools are registered with the MCP server.")
                )
            } else {
                ScrollView {
                    VStack(spacing: 8) {
                        ForEach(viewModel.tools) { tool in
                            ToolCardView(tool: tool, viewModel: viewModel, mcpPort: mcpPort)
                        }
                    }
                    .padding(8)
                }
            }

            // Tool result display
            if let result = viewModel.toolResult {
                Divider()
                ToolResultView(result: result)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 8)
            }

            Divider()

            HStack {
                Text("\(viewModel.tools.count) tool\(viewModel.tools.count == 1 ? "" : "s")")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Spacer()
                Button("Refresh") {
                    if case .ready(let port) = serverState.mcpStatus {
                        viewModel.fetchTools(port: port)
                    }
                }
                .buttonStyle(.borderless)
                .font(.caption)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
        }
    }

    private var mcpPort: Int {
        if case .ready(let port) = serverState.mcpStatus {
            return port
        }
        return 0
    }
}

// MARK: - Tool Card View

private struct ToolCardView: View {
    let tool: MCPTool
    @ObservedObject var viewModel: MCPToolsViewModel
    let mcpPort: Int
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header - tap to expand
            Button(action: {
                withAnimation(.easeInOut(duration: 0.2)) {
                    expanded.toggle()
                }
            }, label: {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "terminal")
                        .foregroundColor(.blue)
                        .frame(width: 20)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(tool.name)
                            .font(.system(.subheadline, design: .monospaced))
                            .fontWeight(.semibold)
                        if !tool.description.isEmpty {
                            Text(tool.description)
                                .font(.caption)
                                .foregroundColor(.secondary)
                                .lineLimit(expanded ? 10 : 2)
                        }
                    }
                    Spacer()
                    Image(systemName: expanded ? "chevron.up" : "chevron.down")
                        .foregroundColor(.secondary)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
                .contentShape(Rectangle())
            })
            .buttonStyle(.plain)

            // Expanded parameter form
            if expanded, let schema = tool.inputSchema {
                Divider()
                ParameterForm(schema: schema, tool: tool, viewModel: viewModel, mcpPort: mcpPort)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 8)
            } else if expanded {
                Divider()
                VStack(spacing: 8) {
                    Text("No parameters required")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Button("Run") {
                        runTool(arguments: [:])
                    }
                    .disabled(viewModel.isRunningTool)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 8)
            }
        }
        .background(Color(NSColor.controlBackgroundColor))
        .cornerRadius(6)
    }

    private func runTool(arguments: [String: Any]) {
        viewModel.callTool(tool, port: mcpPort, arguments: arguments)
    }
}

// MARK: - Parameter Form

private struct ParameterForm: View {
    let schema: MCPToolSchema
    let tool: MCPTool
    @ObservedObject var viewModel: MCPToolsViewModel
    let mcpPort: Int
    @State private var parameterValues: [String: String] = [:]

    var allValid: Bool {
        for fieldName in schema.required {
            if parameterValues[fieldName]?.trimmingCharacters(in: .whitespaces).isEmpty ?? true {
                return false
            }
        }
        return true
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(schema.properties.sorted(by: { $0.key < $1.key })), id: \.key) { name, param in
                let defaultValue = param.defaultValue as? String ?? ""
                ParameterField(
                    name: name,
                    param: param,
                    isRequired: schema.required.contains(name),
                    value: Binding(
                        get: { parameterValues[name, default: defaultValue] },
                        set: { parameterValues[name] = $0 }
                    )
                )
            }

            HStack {
                Spacer()
                if viewModel.isRunningTool {
                    ProgressView()
                        .scaleEffect(0.8)
                }
                Button("Run") {
                    let args = convertArguments()
                    viewModel.callTool(tool, port: mcpPort, arguments: args)
                }
                .disabled(!allValid || viewModel.isRunningTool)
            }
        }
    }

    private func convertArguments() -> [String: Any] {
        var result: [String: Any] = [:]
        for (name, param) in schema.properties {
            guard let rawValue = parameterValues[name]?.trimmingCharacters(in: .whitespaces),
                  !rawValue.isEmpty else { continue }

            switch param.type {
            case "string":
                result[name] = rawValue
            case "number":
                if let intVal = Int(rawValue) {
                    result[name] = intVal
                } else if let doubleVal = Double(rawValue) {
                    result[name] = doubleVal
                }
            case "boolean":
                result[name] = rawValue.lowercased() == "true" || rawValue == "1"
            case "array":
                let items = rawValue.components(separatedBy: ",")
                    .map { $0.trimmingCharacters(in: .whitespaces) }
                    .filter { !$0.isEmpty }
                result[name] = items
            case "object":
                if let data = rawValue.data(using: .utf8),
                   let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    result[name] = parsed
                }
            default:
                result[name] = rawValue
            }
        }
        return result
    }
}

// MARK: - Parameter Field

private struct ParameterField: View {
    let name: String
    let param: MCPToolParameter
    let isRequired: Bool
    @Binding var value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(name)
                    .font(.system(.caption, design: .monospaced))
                    .fontWeight(.semibold)
                if isRequired {
                    Text("*")
                        .foregroundColor(.red)
                        .font(.caption)
                }
                Spacer()
                Text("(\(param.type))")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
            if let desc = param.description {
                Text(desc)
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }
            if name == "content" || name.hasSuffix("Content") {
                TextEditor(text: $value)
                    .font(.system(.caption, design: .monospaced))
                    .frame(height: 80)
                    .border(Color.gray.opacity(0.3))
            } else if param.type == "array" {
                TextField("", text: $value, prompt: Text(param.description ?? "Comma-separated values..."))
                    .font(.system(.caption, design: .monospaced))
            } else if param.type == "number" {
                TextField("", text: $value, prompt: Text(param.description ?? "Enter a number..."))
                    .font(.system(.caption, design: .monospaced))
            } else {
                TextField("", text: $value, prompt: Text(param.description ?? "Enter value..."))
                    .font(.system(.caption, design: .monospaced))
            }
        }
    }
}

// MARK: - Tool Result View

private struct ToolResultView: View {
    let result: ToolResult

    private static let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss"
        return f
    }()

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: result.success ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                    .foregroundColor(result.success ? .green : .red)
                Text(result.toolName)
                    .font(.system(.subheadline, design: .monospaced))
                    .fontWeight(.semibold)
                Spacer()
                Text(ToolResultView.timeFormatter.string(from: result.timestamp))
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
            ScrollView {
                Text(result.resultJSON)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(height: min(200.0, max(80.0, CGFloat(result.resultJSON.utf8.count / 4))))
            .border(Color.gray.opacity(0.3))
            .background(Color(NSColor.textBackgroundColor))
        }
    }
}

// MARK: - Shared Log Panel

private struct LogPanelView: View {
    let entries: [LogStore.Entry]

    private static let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss"
        return f
    }()

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                Text(
                    entries.map { entry in
                        "\(Self.timeFormatter.string(from: entry.timestamp))  \(entry.message)"
                    }.joined(separator: "\n")
                )
                .font(.system(.caption, design: .monospaced))
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
                .padding(8)
                .id("logBottom")
            }
            .onChange(of: entries.count) { _ in
                withAnimation {
                    proxy.scrollTo("logBottom", anchor: .bottom)
                }
            }
        }
    }
}

// MARK: - Helpers

private let _timeFormatter: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "HH:mm:ss"
    return f
}()

private func logText(_ entries: [LogStore.Entry]) -> String {
    entries.map { entry in
        "\(_timeFormatter.string(from: entry.timestamp))  \(entry.message)"
    }.joined(separator: "\n")
}

// MARK: - Chat Log Tab

private struct ChatLogTab: View {
    @EnvironmentObject private var logStore: ChatLogStore
    @EnvironmentObject private var preferences: PreferencesStore

    var body: some View {
        VStack(spacing: 0) {
            LogPanelView(entries: logStore.entries)

            Divider()

            HStack {
                Text("\(logStore.entries.count) entries")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Spacer()
                Button("Open Chat") {
                    let chatURL = URL(string: "http://127.0.0.1:\(preferences.chatPort)")!
                    NSWorkspace.shared.open(chatURL)
                }
                .buttonStyle(.borderless)
                .font(.caption)
                .help("Open the chat UI in your browser")
                Button("Copy") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(logText(logStore.entries), forType: .string)
                }
                .buttonStyle(.borderless)
                .font(.caption)
                Button("Clear") {
                    logStore.clear()
                }
                .buttonStyle(.borderless)
                .font(.caption)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
        }
    }
}
