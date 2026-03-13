import Foundation
import os

private let logger = Logger(subsystem: "lindaAssistant", category: "ChatStreamHandler")

@Observable
public final class ChatStreamHandler: @unchecked Sendable {
    public private(set) var isStreaming = false
    public private(set) var isConnected = false
    public private(set) var isReconnecting = false
    public private(set) var isCompacting = false
    public private(set) var streamingParts: [MessagePart] = []
    public private(set) var pendingConfirmations: [ConfirmationPayload] = []
    /// The first unresolved confirmation in the queue (what the UI should show).
    public var pendingConfirmation: ConfirmationPayload? { pendingConfirmations.first }
    public private(set) var error: String?

    /// Computed: extract tool calls from streaming parts (for confirmation lookup).
    public var streamingToolCalls: [ToolCallInfo] {
        streamingParts.compactMap { if case .tool(let info) = $0 { return info } else { return nil } }
    }

    // Text buffering: accumulate chunks and flush on a 0.5s throttle
    @ObservationIgnored private var _textBuffer = ""
    @ObservationIgnored private var _flushTask: Task<Void, Never>?
    @ObservationIgnored private let flushInterval: Duration = .milliseconds(500)

    public var onAssistantMessage: (@MainActor (_ parts: [MessagePart]) -> Void)?
    public var onReconnected: (@MainActor () async -> Void)?
    public var onConfirmationResolved: (@MainActor (_ toolCallId: String, _ action: String) -> Void)?
    public var onToolResult: (@MainActor (_ toolCallId: String, _ isError: Bool, _ errorMessage: String?) -> Void)?
    public var onUserMessage: (@MainActor (_ id: String, _ content: String) -> Void)?

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

    @discardableResult
    public func sendChatMessage(assigneeId: String, content: String) async -> String? {
        logger.info("sendChatMessage: assigneeId=\(assigneeId), isConnected=\(self.isConnected)")
        await MainActor.run {
            self._flushTask?.cancel()
            self._flushTask = nil
            self._textBuffer = ""
            self.streamingParts = []
            self.pendingConfirmations = []
            self.error = nil
            self.isStreaming = true
        }
        eventManager.emit(.streamContentUpdated)

        do {
            let response = try await apiClient.sendChatMessage(assigneeId: assigneeId, SendMessage(content: content))
            logger.info("sendChatMessage: API call succeeded")
            return response.messageId
        } catch {
            logger.error("sendChatMessage error: \(error)")
            await MainActor.run {
                self.error = error.localizedDescription
                self.isStreaming = false
            }
            eventManager.emit(.error(message: error.localizedDescription))
            return nil
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
                } catch is CancellationError {
                    // Task cancelled (e.g. disconnect) — not a real error
                } catch let urlError as URLError where urlError.code == .cancelled {
                    // URLSession cancelled — not a real error
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
        } catch is CancellationError {
            return
        } catch let urlError as URLError where urlError.code == .cancelled {
            return
        } catch {
            logger.error("connect error: \(error)")
            await MainActor.run { self.error = error.localizedDescription }
            eventManager.emit(.error(message: error.localizedDescription))
        }
    }

    @discardableResult
    public func sendMessage(sessionId: String, content: String) async -> String? {
        logger.info("sendMessage: sessionId=\(sessionId), isConnected=\(self.isConnected)")
        // Reset per-run state on MainActor so @Observable triggers SwiftUI updates
        await MainActor.run {
            self._flushTask?.cancel()
            self._flushTask = nil
            self._textBuffer = ""
            self.streamingParts = []
            self.pendingConfirmations = []
            self.error = nil
            self.isStreaming = true
        }
        eventManager.emit(.streamContentUpdated)

        do {
            let response = try await apiClient.sendMessage(sessionId: sessionId, SendMessage(content: content))
            logger.info("sendMessage: API call succeeded")
            return response.messageId
        } catch {
            logger.error("sendMessage error: \(error)")
            await MainActor.run {
                self.error = error.localizedDescription
                self.isStreaming = false
            }
            eventManager.emit(.error(message: error.localizedDescription))
            return nil
        }
    }

    public func resolveConfirmation(confirmationId: String, action: String, alwaysAllow: Bool = false) async {
        do {
            let body = ResolveConfirmation(action: action, alwaysAllow: alwaysAllow ? true : nil)
            let response = try await apiClient.resolveConfirmation(id: confirmationId, body)
            await MainActor.run {
                pendingConfirmations.removeAll { $0.confirmationId == confirmationId }
            }
            eventManager.emit(.confirmationResolved(response.confirmationId, response.action))
        } catch {
            self.error = error.localizedDescription
        }
    }

    @MainActor
    public func setPendingConfirmation(_ payload: ConfirmationPayload) {
        if !pendingConfirmations.contains(where: { $0.confirmationId == payload.confirmationId }) {
            pendingConfirmations.append(payload)
        }
    }

    @MainActor
    public func setPendingConfirmations(_ payloads: [ConfirmationPayload]) {
        pendingConfirmations = payloads
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

    public func stopStream(sessionId: String) async {
        logger.info("stopStream: sessionId=\(sessionId)")
        do {
            _ = try await apiClient.stopStream(sessionId: sessionId)
            logger.info("stopStream: API call succeeded")
        } catch {
            logger.error("stopStream error: \(error)")
        }
        await MainActor.run {
            self.finalizeResponse()
        }
    }

    public func stopChatStream(assigneeId: String) async {
        logger.info("stopChatStream: assigneeId=\(assigneeId)")
        do {
            _ = try await apiClient.stopChatStream(assigneeId: assigneeId)
            logger.info("stopChatStream: API call succeeded")
        } catch {
            logger.error("stopChatStream error: \(error)")
        }
        await MainActor.run {
            self.finalizeResponse()
        }
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
                isCompacting = false
                if !isStreaming { isStreaming = true }
                _textBuffer += payload.text
                // Start a throttle timer if one isn't already running
                if _flushTask == nil {
                    scheduleFlush()
                }
                logger.debug("textDelta: buffer=\(self._textBuffer.count), isStreaming=\(self.isStreaming)")

            case let .toolCall(payload):
                logger.info("toolCall: \(payload.toolName) id=\(payload.toolCallId)")
                if let index = streamingParts.firstIndex(where: {
                    if case .tool(let info) = $0 { return info.toolCallId == payload.toolCallId }
                    return false
                }) {
                    // Re-emitted after confirmation — update status back to running
                    if case .tool(var info) = streamingParts[index] {
                        info.status = .running
                        streamingParts[index] = .tool(info)
                    }
                } else {
                    let info = ToolCallInfo(
                        toolCallId: payload.toolCallId,
                        toolName: payload.toolName,
                        input: payload.input,
                        status: .running
                    )
                    streamingParts.append(.tool(info))
                }

            case let .toolResult(payload):
                logger.info("toolResult: toolCallId=\(payload.toolCallId), isError=\(payload.isError ?? false)")
                if let index = streamingParts.firstIndex(where: {
                    if case .tool(let info) = $0 { return info.toolCallId == payload.toolCallId }
                    return false
                }) {
                    if case .tool(var info) = streamingParts[index] {
                        if payload.isError == true {
                            info.status = .failed
                            info.errorMessage = payload.error
                        } else {
                            info.status = .completed
                        }
                        info.result = payload.output
                        streamingParts[index] = .tool(info)
                    }
                } else {
                    // Reloaded session: tool call is in displayMessages, not streaming list
                    onToolResult?(payload.toolCallId, payload.isError == true, payload.error)
                }

            case let .confirmationRequired(payload):
                logger.info("confirmationRequired: \(payload.toolName) id=\(payload.confirmationId)")
                // Update the corresponding tool call status so streaming badges show "Needs Confirmation"
                if let index = streamingParts.firstIndex(where: {
                    if case .tool(let info) = $0 { return info.toolCallId == payload.toolCallId }
                    return false
                }) {
                    if case .tool(var info) = streamingParts[index] {
                        info.status = .pendingConfirmation
                        streamingParts[index] = .tool(info)
                    }
                }
                // Avoid duplicates from SSE replay
                if !pendingConfirmations.contains(where: { $0.confirmationId == payload.confirmationId }) {
                    pendingConfirmations.append(payload)
                }

            case let .confirmationResolved(payload):
                logger
                    .info(
                        "confirmationResolved: \(payload.toolName) id=\(payload.confirmationId) action=\(payload.action)"
                    )
                pendingConfirmations.removeAll { $0.confirmationId == payload.confirmationId }
                // Immediate feedback: update streaming tool call status
                if let index = streamingParts.firstIndex(where: {
                    if case .tool(let info) = $0 { return info.toolCallId == payload.toolCallId }
                    return false
                }) {
                    if case .tool(var info) = streamingParts[index] {
                        info.status = payload.action == "rejected" ? .rejected : .running
                        streamingParts[index] = .tool(info)
                    }
                }
                onConfirmationResolved?(payload.toolCallId, payload.action)

            case let .userMessage(payload):
                logger.info("userMessage: id=\(payload.id), content=\(payload.content.prefix(50))")
                onUserMessage?(payload.id, payload.content)

            case let .compacting(payload):
                logger.info("compacting: messageCount=\(payload.messageCount ?? 0)")
                isCompacting = true

            case let .error(payload):
                logger.error("SSE error event: \(payload.error)")
                error = payload.error
                finalizeResponse()

            case .done:
                logger.info("done: streamingParts count=\(self.streamingParts.count)")
                finalizeResponse()

            case let .status(payload):
                logger.info("status: \(payload.status)")
                if payload.status == "in_progress" {
                    isStreaming = true
                } else if payload.status == "stopped" {
                    finalizeResponse()
                } else if payload.status == "waiting_confirmation" {
                    // Agent paused for confirmation — stop streaming indicator
                    // but keep streamingParts and pendingConfirmations visible
                    isStreaming = false
                }

            case let .unknown(data):
                logger.warning("unknown event, data=\(data.prefix(200))")
        }
    }

    @MainActor
    private func scheduleFlush() {
        // Start a throttle timer — flush after 0.5s, buffering all chunks in between
        _flushTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: self?.flushInterval ?? .milliseconds(500))
            guard let self, !Task.isCancelled else { return }
            self.flushBuffer()
        }
    }

    @MainActor
    private func flushBuffer() {
        _flushTask?.cancel()
        _flushTask = nil
        if !_textBuffer.isEmpty {
            let buffer = _textBuffer
            _textBuffer = ""
            // Append to last text part if it's streaming, otherwise create a new one
            if let lastIndex = streamingParts.indices.last,
               case .text(.streaming(var chunks)) = streamingParts[lastIndex]
            {
                chunks.append(buffer)
                streamingParts[lastIndex] = .text(.streaming(chunks))
            } else {
                streamingParts.append(.text(.streaming([buffer])))
            }
        }
        eventManager.emit(.streamContentUpdated)
    }

    @MainActor
    private func finalizeResponse() {
        // Flush any remaining buffered text immediately
        _flushTask?.cancel()
        flushBuffer()

        logger
            .info(
                "finalizeResponse: streamingParts.count=\(self.streamingParts.count), hasCallback=\(self.onAssistantMessage != nil)"
            )
        if !streamingParts.isEmpty {
            // Convert streaming text parts to finalized plain text
            let finalizedParts = streamingParts.map { part -> MessagePart in
                if case .text(let content) = part {
                    return .text(.plain(content.displayText))
                }
                return part
            }
            logger
                .info(
                    "finalizeResponse: calling onAssistantMessage with \(finalizedParts.count) parts"
                )
            onAssistantMessage?(finalizedParts)
        }
        streamingParts = []
        // Don't clear pendingConfirmations — they must persist until resolved
        isCompacting = false
        isStreaming = false
        eventManager.emit(.streamContentUpdated)
    }
}

// MARK: - Message Part

public enum TextPartContent: Sendable {
    case plain(String)
    case streaming([String])

    public var displayText: String {
        switch self {
        case .plain(let s): return s
        case .streaming(let chunks): return chunks.joined()
        }
    }
}

public enum MessagePart: Sendable {
    case text(TextPartContent)
    case tool(ToolCallInfo)
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
