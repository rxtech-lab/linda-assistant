import Foundation
import os

private let logger = Logger(subsystem: "lindaAssistant", category: "ChatStreamHandler")

@Observable
public final class ChatStreamHandler: @unchecked Sendable {
    public private(set) var isStreaming = false
    public private(set) var isConnected = false
    public private(set) var isReconnecting = false
    public private(set) var streamedText = ""
    public private(set) var pendingConfirmation: ConfirmationPayload?
    public private(set) var toolCalls: [ToolCallInfo] = []
    public private(set) var error: String?

    public var onAssistantMessage: (@MainActor (String, [ToolCallInfo]) -> Void)?
    public var onReconnected: (@MainActor () async -> Void)?

    private let apiClient: APIClient
    private let sseClient: SSEClient
    private let eventManager: EventManager
    private var streamTask: Task<Void, Never>?

    public init(apiClient: APIClient, sseClient: SSEClient, eventManager: EventManager) {
        self.apiClient = apiClient
        self.sseClient = sseClient
        self.eventManager = eventManager
    }

    public func connectByAssignee(assigneeId: String) async {
        await connectToPath("chat/\(assigneeId)/stream")
    }

    public func connect(sessionId: String) async {
        await connectToPath("chat-sessions/\(sessionId)/stream")
    }

    public func sendChatMessage(assigneeId: String, content: String) async {
        logger.info("sendChatMessage: assigneeId=\(assigneeId), isConnected=\(self.isConnected)")
        await MainActor.run {
            self.streamedText = ""
            self.pendingConfirmation = nil
            self.toolCalls = []
            self.error = nil
            self.isStreaming = true
        }

        do {
            _ = try await apiClient.sendChatMessage(assigneeId: assigneeId, SendMessage(content: content))
            logger.info("sendChatMessage: API call succeeded")
        } catch {
            logger.error("sendChatMessage error: \(error)")
            await MainActor.run {
                self.error = error.localizedDescription
                self.isStreaming = false
            }
            eventManager.emit(.error(message: error.localizedDescription))
        }
    }

    private func connectToPath(_ path: String) async {
        guard !isConnected else {
            logger.info("connect: already connected")
            return
        }

        do {
            let request = try await apiClient.buildSSERequest(path: path)
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
                        await handleEvent(message)
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

    public func resolveConfirmation(confirmationId: String, action: String, alwaysAllow: Bool = false) async {
        do {
            let body = ResolveConfirmation(action: action, alwaysAllow: alwaysAllow ? true : nil)
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
    public func clearError() {
        error = nil
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
        // Track reconnection transitions
        if case .reconnecting = message {
            isReconnecting = true
        } else if isReconnecting {
            // First real event after reconnecting -> we're back
            isReconnecting = false
            logger.info("handleEvent: reconnected, calling onReconnected")
            Task { await onReconnected?() }
        }

        switch message {
            case .reconnecting:
                logger.info("handleEvent: reconnecting...")

            case let .textDelta(payload):
                if !isStreaming { isStreaming = true }
                streamedText += payload.text
                logger.debug("textDelta: accumulated length=\(self.streamedText.count), isStreaming=\(self.isStreaming)")

            case let .toolCall(payload):
                logger.info("toolCall: \(payload.toolName) id=\(payload.toolCallId)")
                let info = ToolCallInfo(
                    toolCallId: payload.toolCallId,
                    toolName: payload.toolName,
                    input: payload.input,
                    status: .running
                )
                toolCalls.append(info)

            case let .toolResult(payload):
                logger.info("toolResult: toolCallId=\(payload.toolCallId), isError=\(payload.isError ?? false)")
                if let index = toolCalls.firstIndex(where: { $0.toolCallId == payload.toolCallId }) {
                    if payload.isError == true {
                        toolCalls[index].status = .failed
                        toolCalls[index].errorMessage = payload.error
                    } else {
                        toolCalls[index].status = .completed
                    }
                    toolCalls[index].result = payload.output
                }

            case let .confirmationRequired(payload):
                logger.info("confirmationRequired: \(payload.toolName) id=\(payload.confirmationId)")
                pendingConfirmation = payload

            case let .error(payload):
                logger.error("SSE error event: \(payload.error)")
                error = payload.error
                finalizeResponse()

            case .done:
                logger.info("done: streamedText length=\(self.streamedText.count)")
                finalizeResponse()

            case let .status(payload):
                logger.info("status: \(payload.status)")
                if payload.status == "in_progress" {
                    isStreaming = true
                } else if payload.status == "stopped" {
                    finalizeResponse()
                }

            case let .unknown(data):
                logger.warning("unknown event, data=\(data.prefix(200))")
        }
    }

    @MainActor
    private func finalizeResponse() {
        logger
            .info(
                "finalizeResponse: streamedText.count=\(self.streamedText.count), toolCalls.count=\(self.toolCalls.count), hasCallback=\(self.onAssistantMessage != nil)"
            )
        if !streamedText.isEmpty || !toolCalls.isEmpty {
            logger
                .info(
                    "finalizeResponse: calling onAssistantMessage with text=\(self.streamedText.prefix(100)), toolCalls=\(self.toolCalls.count)"
                )
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
    public var errorMessage: String?

    public init(
        toolCallId: String,
        toolName: String,
        input: [String: AnyCodable]?,
        status: ToolCallStatus,
        result: AnyCodable? = nil,
        errorMessage: String? = nil
    ) {
        self.toolCallId = toolCallId
        self.toolName = toolName
        self.input = input
        self.status = status
        self.result = result
        self.errorMessage = errorMessage
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
