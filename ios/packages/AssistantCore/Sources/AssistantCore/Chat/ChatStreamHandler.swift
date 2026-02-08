import Foundation

@Observable
public final class ChatStreamHandler: @unchecked Sendable {
    public private(set) var isStreaming = false
    public private(set) var streamedText = ""
    public private(set) var pendingConfirmation: ConfirmationPayload?
    public private(set) var toolCalls: [ToolCallInfo] = []
    public private(set) var error: String?

    private let apiClient: APIClient
    private let sseClient: SSEClient
    private let eventManager: EventManager
    private var streamTask: Task<Void, Never>?

    public init(apiClient: APIClient, sseClient: SSEClient, eventManager: EventManager) {
        self.apiClient = apiClient
        self.sseClient = sseClient
        self.eventManager = eventManager
    }

    public func sendMessageAndStream(sessionId: String, content: String) async {
        // Reset state
        streamedText = ""
        pendingConfirmation = nil
        toolCalls = []
        error = nil
        isStreaming = true

        do {
            // Post message
            _ = try await apiClient.sendMessage(sessionId: sessionId, SendMessage(content: content))

            // Connect SSE
            let request = try await apiClient.buildSSERequest(path: "chat-sessions/\(sessionId)/stream")
            guard let url = request.url else {
                throw APIError.invalidResponse
            }

            let stream = await sseClient.connect(url: url)

            for try await event in stream {
                await handleEvent(event)
            }
        } catch {
            self.error = error.localizedDescription
            eventManager.emit(.error(message: error.localizedDescription))
        }

        isStreaming = false
    }

    public func resolveConfirmation(confirmationId: String, action: String) async {
        do {
            let body = ResolveConfirmation(action: action)
            let response = try await apiClient.resolveConfirmation(id: confirmationId, body)
            pendingConfirmation = nil
            eventManager.emit(.confirmationResolved(response.confirmationId, response.action))
        } catch {
            self.error = error.localizedDescription
        }
    }

    public func cancel() {
        streamTask?.cancel()
        streamTask = nil
        isStreaming = false
    }

    @MainActor
    private func handleEvent(_ event: SSEEvent) {
        let decoder = JSONDecoder()

        switch event.type {
        case .textDelta:
            if let data = event.data.data(using: .utf8),
               let payload = try? decoder.decode(TextDeltaPayload.self, from: data) {
                streamedText += payload.text
            }

        case .toolCall:
            if let data = event.data.data(using: .utf8),
               let payload = try? decoder.decode(ToolCallPayload.self, from: data) {
                let info = ToolCallInfo(
                    toolCallId: payload.toolCallId,
                    toolName: payload.toolName,
                    args: payload.args,
                    status: .running
                )
                toolCalls.append(info)
            }

        case .toolResult:
            if let data = event.data.data(using: .utf8),
               let payload = try? decoder.decode(ToolResultPayload.self, from: data) {
                if let index = toolCalls.firstIndex(where: { $0.toolCallId == payload.toolCallId }) {
                    toolCalls[index].status = .completed
                    toolCalls[index].result = payload.result
                }
            }

        case .confirmationRequired:
            if let data = event.data.data(using: .utf8),
               let payload = try? decoder.decode(ConfirmationPayload.self, from: data) {
                pendingConfirmation = payload
            }

        case .error:
            if let data = event.data.data(using: .utf8),
               let payload = try? decoder.decode(SSEErrorPayload.self, from: data) {
                error = payload.message
            }

        case .done:
            isStreaming = false

        case .unknown:
            break
        }
    }
}

// MARK: - Tool Call Info

public struct ToolCallInfo: Identifiable, Sendable {
    public let id = UUID()
    public let toolCallId: String
    public let toolName: String
    public let args: [String: AnyCodable]?
    public var status: ToolCallStatus
    public var result: AnyCodable?
}

public enum ToolCallStatus: Sendable {
    case running
    case completed
    case failed
}
