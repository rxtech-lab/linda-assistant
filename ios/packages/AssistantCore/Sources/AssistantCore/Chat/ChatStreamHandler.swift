import Foundation
import os

private let logger = Logger(subsystem: "lindaAssistant", category: "ChatStreamHandler")

@Observable
public final class ChatStreamHandler: @unchecked Sendable {
    public private(set) var isStreaming = false
    public private(set) var isConnected = false
    public private(set) var streamedText = ""
    public private(set) var pendingConfirmation: ConfirmationPayload?
    public private(set) var toolCalls: [ToolCallInfo] = []
    public private(set) var error: String?

    public var onAssistantMessage: (@MainActor (String, [ToolCallInfo]) -> Void)?

    private let apiClient: APIClient
    private let sseClient: SSEClient
    private let eventManager: EventManager
    private var streamTask: Task<Void, Never>?

    public init(apiClient: APIClient, sseClient: SSEClient, eventManager: EventManager) {
        self.apiClient = apiClient
        self.sseClient = sseClient
        self.eventManager = eventManager
    }

    public func connect(sessionId: String) async {
        guard !isConnected else {
            logger.info("connect: already connected")
            return
        }

        do {
            let request = try await apiClient.buildSSERequest(path: "chat-sessions/\(sessionId)/stream")
            guard let url = request.url else {
                throw APIError.invalidResponse
            }

            logger.info("connect: SSE url=\(url.absoluteString)")
            let stream = await sseClient.connect(url: url)
            await MainActor.run { self.isConnected = true }
            logger.info("connect: SSE connected")

            streamTask = Task { [weak self] in
                do {
                    for try await event in stream {
                        guard let self else { return }
                        let message = event.parse()
                        logger.debug("SSE event: type=\(event.type.rawValue) data=\(event.data.prefix(100))")
                        await self.handleEvent(message)
                    }
                    logger.info("SSE stream ended normally")
                } catch {
                    if !Task.isCancelled {
                        logger.error("SSE stream error: \(error)")
                        await MainActor.run { [weak self] in
                            self?.error = error.localizedDescription
                            self?.eventManager.emit(.error(message: error.localizedDescription))
                        }
                    }
                }
                await MainActor.run { [weak self] in
                    self?.isConnected = false
                    self?.isStreaming = false
                }
            }
        } catch {
            logger.error("connect error: \(error)")
            await MainActor.run { self.error = error.localizedDescription }
            eventManager.emit(.error(message: error.localizedDescription))
        }
    }

    public func sendMessage(sessionId: String, content: String) async {
        logger.info("sendMessage: sessionId=\(sessionId), isConnected=\(self.isConnected)")
        // Reset per-run state on MainActor so @Observable triggers SwiftUI updates
        await MainActor.run {
            self.streamedText = ""
            self.pendingConfirmation = nil
            self.toolCalls = []
            self.error = nil
            self.isStreaming = true
        }

        do {
            _ = try await apiClient.sendMessage(sessionId: sessionId, SendMessage(content: content))
            logger.info("sendMessage: API call succeeded")
        } catch {
            logger.error("sendMessage error: \(error)")
            await MainActor.run {
                self.error = error.localizedDescription
                self.isStreaming = false
            }
            eventManager.emit(.error(message: error.localizedDescription))
        }
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

    @MainActor
    public func setPendingConfirmation(_ payload: ConfirmationPayload) {
        pendingConfirmation = payload
    }

    @MainActor
    public func disconnect() {
        streamTask?.cancel()
        streamTask = nil
        Task { await sseClient.disconnect() }
        isConnected = false
        isStreaming = false
    }

    @MainActor
    private func handleEvent(_ message: SSEMessage) {
        switch message {
        case .textDelta(let payload):
            if !isStreaming { isStreaming = true }
            streamedText += payload.text
            logger.debug("textDelta: accumulated length=\(self.streamedText.count), isStreaming=\(self.isStreaming)")

        case .toolCall(let payload):
            logger.info("toolCall: \(payload.toolName) id=\(payload.toolCallId)")
            let info = ToolCallInfo(
                toolCallId: payload.toolCallId,
                toolName: payload.toolName,
                input: payload.input,
                status: .running
            )
            toolCalls.append(info)

        case .toolResult(let payload):
            logger.info("toolResult: toolCallId=\(payload.toolCallId)")
            if let index = toolCalls.firstIndex(where: { $0.toolCallId == payload.toolCallId }) {
                toolCalls[index].status = .completed
                toolCalls[index].result = payload.output
            }

        case .confirmationRequired(let payload):
            logger.info("confirmationRequired: \(payload.toolName) id=\(payload.confirmationId)")
            pendingConfirmation = payload

        case .error(let payload):
            logger.error("SSE error event: \(payload.error)")
            self.error = payload.error

        case .done:
            logger.info("done: streamedText length=\(self.streamedText.count)")
            finalizeResponse()

        case .status(let payload):
            logger.info("status: \(payload.status)")
            if payload.status == "in_progress" {
                isStreaming = true
            } else if payload.status == "stopped" {
                finalizeResponse()
            }

        case .unknown(let data):
            logger.warning("unknown event, data=\(data.prefix(200))")
        }
    }

    @MainActor
    private func finalizeResponse() {
        logger.info("finalizeResponse: streamedText.count=\(self.streamedText.count), toolCalls.count=\(self.toolCalls.count), hasCallback=\(self.onAssistantMessage != nil)")
        if !streamedText.isEmpty || !toolCalls.isEmpty {
            logger.info("finalizeResponse: calling onAssistantMessage with text=\(self.streamedText.prefix(100)), toolCalls=\(self.toolCalls.count)")
            onAssistantMessage?(streamedText, toolCalls)
        }
        streamedText = ""
        toolCalls = []
        // Don't clear pendingConfirmation — it must persist until resolved
        isStreaming = false
    }
}

// MARK: - Tool Call Info

public struct ToolCallInfo: Identifiable, Sendable {
    public let id = UUID()
    public let toolCallId: String
    public let toolName: String
    public let input: [String: AnyCodable]?
    public var status: ToolCallStatus
    public var result: AnyCodable?

    public init(toolCallId: String, toolName: String, input: [String: AnyCodable]?, status: ToolCallStatus, result: AnyCodable? = nil) {
        self.toolCallId = toolCallId
        self.toolName = toolName
        self.input = input
        self.status = status
        self.result = result
    }
}

public enum ToolCallStatus: Sendable, Equatable {
    case running
    case completed
    case failed
    case pendingConfirmation
    case rejected

    /// Map a confirmation status string to a ToolCallStatus.
    public static func from(confirmation: ToolCallConfirmation?) -> ToolCallStatus {
        guard let status = confirmation?.status else { return .completed }
        switch status {
        case "rejected": return .rejected
        case "pending": return .pendingConfirmation
        default: return .completed
        }
    }
}
