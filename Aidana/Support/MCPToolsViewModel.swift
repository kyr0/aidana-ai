//
//  MCPToolsViewModel.swift
//  Aidana
//

import Foundation

// MARK: - Model Types

struct MCPToolParameter: Codable, Sendable {
    let type: String
    let description: String?
    let defaultValue: String?
    let properties: [String: MCPToolParameter]?
    let required: [String]?
}

struct MCPToolSchema: Codable, Sendable {
    let type: String
    let properties: [String: MCPToolParameter]
    let required: [String]
}

struct MCPTool: Identifiable, Codable, Sendable {
    let id: String
    let name: String
    let description: String
    let inputSchema: MCPToolSchema?

    init(id: String, name: String, description: String, inputSchema: MCPToolSchema? = nil) {
        self.id = id
        self.name = name
        self.description = description
        self.inputSchema = inputSchema
    }
}

struct ToolResult: Identifiable {
    let id = UUID()
    let toolName: String
    let arguments: [String: Any]
    let success: Bool
    let resultJSON: String
    let timestamp: Date
}

@MainActor
final class MCPToolsViewModel: ObservableObject {
    @Published private(set) var tools: [MCPTool] = []
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var toolResult: ToolResult?
    @Published private(set) var isRunningTool = false
    
    // Store session ID for tool calls
    private var sessionId: String?

    func fetchTools(port: Int) {
        guard !isLoading else { return }

        isLoading = true
        errorMessage = nil

        Task {
            do {
                // Step 1: Initialize MCP session
                let fetchedSessionId = try await initializeSession(port: port)
                self.sessionId = fetchedSessionId

                // Step 2: List tools using the session
                let fetchedTools = try await listTools(port: port, sessionId: fetchedSessionId)
                self.tools = fetchedTools
            } catch {
                self.errorMessage = error.localizedDescription
            }
            isLoading = false
        }
    }

    // MARK: - MCP Streamable-HTTP Protocol

    private func initializeSession(port: Int) async throws -> String {
        let url = mcpURL(port: port)
        let requestBody: [String: Any] = [
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": [
                "protocolVersion": "2024-11-05",
                "capabilities": [:],
                "clientInfo": ["name": "Aidana", "version": "0.0.1"],
            ],
        ]

        let (data, response) = try await postMCP(url: url, body: requestBody)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw NSError(domain: "MCPTools", code: -1,
                          userInfo: [NSLocalizedDescriptionKey: "Invalid HTTP response from initialize"])
        }

        // Session ID is in the "mcp-session-id" header (case-insensitive lookup)
        for (key, value) in httpResponse.allHeaderFields {
            if (key as? String)?.lowercased() == "mcp-session-id" {
                return value as? String ?? ""
            }
        }

        throw NSError(domain: "MCPTools", code: httpResponse.statusCode,
                      userInfo: [NSLocalizedDescriptionKey: "No mcp-session-id header in initialize response (status \(httpResponse.statusCode))"])
    }

    private func listTools(port: Int, sessionId: String) async throws -> [MCPTool] {
        let url = mcpURL(port: port)
        let requestBody: [String: Any] = [
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list",
        ]

        var (data, response) = try await postMCP(url: url, body: requestBody)

        // Add session header and retry
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json, text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue(sessionId, forHTTPHeaderField: "Mcp-Session-Id")
        guard let httpBody = try? JSONSerialization.data(withJSONObject: requestBody) else {
            throw NSError(domain: "MCPTools", code: -1,
                          userInfo: [NSLocalizedDescriptionKey: "Failed to encode request"])
        }
        request.httpBody = httpBody

        (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw NSError(domain: "MCPTools", code: -1,
                          userInfo: [NSLocalizedDescriptionKey: "Invalid HTTP response from tools/list"])
        }

        if httpResponse.statusCode != 200 {
            let body = String(data: data, encoding: .utf8) ?? "<binary>"
            throw NSError(domain: "MCPTools", code: httpResponse.statusCode,
                          userInfo: [NSLocalizedDescriptionKey: "tools/list returned status \(httpResponse.statusCode): \(body)"])
        }

        // Parse SSE format: "event: message\ndata: {...JSON...}"
        guard let sseText = String(data: data, encoding: .utf8) else {
            throw NSError(domain: "MCPTools", code: -1,
                          userInfo: [NSLocalizedDescriptionKey: "Response is not valid UTF-8"])
        }

        guard let jsonData = extractSSEData(sseText) else {
            throw NSError(domain: "MCPTools", code: -1,
                          userInfo: [NSLocalizedDescriptionKey: "Could not parse SSE response"])
        }

        guard let json = try JSONSerialization.jsonObject(with: jsonData) as? [String: Any] else {
            throw NSError(domain: "MCPTools", code: -1,
                          userInfo: [NSLocalizedDescriptionKey: "SSE data is not a JSON object"])
        }

        // JSON-RPC response: { "result": { "tools": [...] } }
        guard let result = json["result"] as? [String: Any],
              let toolsArray = result["tools"] as? [[String: Any]] else {
            throw NSError(domain: "MCPTools", code: -1,
                          userInfo: [NSLocalizedDescriptionKey: "Unexpected response format from tools/list"])
        }

        var tools: [MCPTool] = []
        for toolDict in toolsArray {
            guard let name = toolDict["name"] as? String,
                  let description = toolDict["description"] as? String else {
                continue
            }
            
            // Parse inputSchema if present
            var schema: MCPToolSchema?
            if let schemaDict = toolDict["inputSchema"] as? [String: Any] {
                let schemaType = schemaDict["type"] as? String ?? "object"
                let rawProperties = schemaDict["properties"] as? [String: [String: Any]] ?? [:]
                let requiredFields = schemaDict["required"] as? [String] ?? []
                
                var properties: [String: MCPToolParameter] = [:]
                for (propName, propDict) in rawProperties {
                    let param = MCPToolParameter(
                        type: propDict["type"] as? String ?? "string",
                        description: propDict["description"] as? String,
                        defaultValue: propDict["default"] as? String,
                        properties: nil,
                        required: nil
                    )
                    properties[propName] = param
                }
                
                schema = MCPToolSchema(type: schemaType, properties: properties, required: requiredFields)
            }
            
            tools.append(MCPTool(id: name, name: name, description: description, inputSchema: schema))
        }

        return tools
    }

    // MARK: - Tool Execution

    func callTool(_ tool: MCPTool, port: Int, arguments: [String: Any]) {
        guard !isRunningTool else { return }
        guard let sessionId = self.sessionId else {
            self.toolResult = ToolResult(
                toolName: tool.name,
                arguments: arguments,
                success: false,
                resultJSON: "\"Error: No active MCP session. Please refresh tools first.\"",
                timestamp: Date()
            )
            return
        }

        isRunningTool = true
        self.toolResult = nil

        Task {
            do {
                let url = mcpURL(port: port)
                let requestBody: [String: Any] = [
                    "jsonrpc": "2.0",
                    "id": 3,
                    "method": "tools/call",
                    "params": [
                        "name": tool.name,
                        "arguments": arguments,
                    ],
                ]

                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.setValue("application/json, text/event-stream", forHTTPHeaderField: "Accept")
                request.setValue(sessionId, forHTTPHeaderField: "Mcp-Session-Id")
                request.httpBody = try JSONSerialization.data(withJSONObject: requestBody)

                let (data, response) = try await URLSession.shared.data(for: request)

                guard let httpResponse = response as? HTTPURLResponse else {
                    throw NSError(domain: "MCPTools", code: -1,
                                  userInfo: [NSLocalizedDescriptionKey: "Invalid HTTP response"])
                }

                if httpResponse.statusCode != 200 {
                    let body = String(data: data, encoding: .utf8) ?? "<binary>"
                    throw NSError(domain: "MCPTools", code: httpResponse.statusCode,
                                  userInfo: [NSLocalizedDescriptionKey: "Server returned status \(httpResponse.statusCode): \(body)"])
                }

                guard let sseText = String(data: data, encoding: .utf8) else {
                    throw NSError(domain: "MCPTools", code: -1,
                                  userInfo: [NSLocalizedDescriptionKey: "Response is not valid UTF-8"])
                }

                guard let jsonData = extractSSEData(sseText) else {
                    throw NSError(domain: "MCPTools", code: -1,
                                  userInfo: [NSLocalizedDescriptionKey: "Could not parse SSE response"])
                }

                guard let json = try JSONSerialization.jsonObject(with: jsonData) as? [String: Any] else {
                    throw NSError(domain: "MCPTools", code: -1,
                                  userInfo: [NSLocalizedDescriptionKey: "SSE data is not a JSON object"])
                }

                guard let result = json["result"] as? [String: Any] else {
                    // Check for JSON-RPC error
                    if let errorObj = json["error"] as? [String: Any],
                       let message = errorObj["message"] as? String {
                        throw NSError(domain: "MCPTools", code: -1,
                                      userInfo: [NSLocalizedDescriptionKey: "MCP Error: \(message)"])
                    }
                    throw NSError(domain: "MCPTools", code: -1,
                                  userInfo: [NSLocalizedDescriptionKey: "Unexpected response format"])
                }

                let isError = result["isError"] as? Bool ?? false
                let prettyJSON = try prettyPrintJSON(result)
                
                await MainActor.run {
                    self.toolResult = ToolResult(
                        toolName: tool.name,
                        arguments: arguments,
                        success: !isError,
                        resultJSON: prettyJSON,
                        timestamp: Date()
                    )
                    self.isRunningTool = false
                }
            } catch {
                await MainActor.run {
                    self.toolResult = ToolResult(
                        toolName: tool.name,
                        arguments: arguments,
                        success: false,
                        resultJSON: "\"Error: \(error.localizedDescription)\"",
                        timestamp: Date()
                    )
                    self.isRunningTool = false
                }
            }
        }
    }

    private func prettyPrintJSON(_ object: Any) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
        return String(data: data, encoding: .utf8) ?? "<encoding error>"
    }

    // MARK: - Helpers

    private func mcpURL(port: Int) -> URL {
        var components = URLComponents()
        components.scheme = "http"
        components.host = "127.0.0.1"
        components.port = port
        components.path = "/mcp"
        return components.url!
    }

    private func postMCP(url: URL, body: [String: Any]) async throws -> (Data, URLResponse) {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json, text/event-stream", forHTTPHeaderField: "Accept")

        guard let httpBody = try? JSONSerialization.data(withJSONObject: body) else {
            throw NSError(domain: "MCPTools", code: -1,
                          userInfo: [NSLocalizedDescriptionKey: "Failed to encode request body"])
        }
        request.httpBody = httpBody

        return try await URLSession.shared.data(for: request)
    }

    /// Extracts the JSON data from an SSE response like "event: message\ndata: {...}"
    private func extractSSEData(_ text: String) -> Data? {
        for line in text.components(separatedBy: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("data: ") {
                let jsonText = String(trimmed.dropFirst(6))
                return jsonText.data(using: .utf8)
            }
        }
        return nil
    }
}
