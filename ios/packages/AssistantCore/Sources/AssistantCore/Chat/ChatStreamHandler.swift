import Foundation
import os

private let logger = Logger(subsystem: "lindaAssistant", category: "ChatStreamHandler")

@Observable
public final class ChatStreamHandler: @unchecked Sendable {
    public private(set) var isStreaming = false
    public private(set) var isConnected = false
    public private(set) var isReconnecting = false
    public private(set) var isCompacting = false
    public private(set) var streamedText = ""
    public private(set) var pendingConfirmations: [ConfirmationPayload] = []
    /// The first unresolved confirmation in the queue (what the UI should show).
    public var pendingConfirmation: ConfirmationPayload? { pendingConfirmations.first }
    public private(set) var toolCalls: [ToolCallInfo] = []
    public private(set) var error: String?

    /// Tracks the arrival order of stream items. `.text` appears once (for the accumulated text blob),
    /// `.toolCall(id)` appears per tool call. The UI renders streaming items in this order.
    public private(set) var streamOrder: [StreamItemKind] = []

    // Text buffering: accumulate chunks and flush when 12 chunks filled or 1s idle
    @ObservationIgnored private var _textBuffer = ""
    @ObservationIgnored private var _chunkCount = 0
    @ObservationIgnored private var _flushTask: Task<Void, Never>?
    @ObservationIgnored private let maxChunks = 4
    @ObservationIgnored private let idleFlushDelay: Duration = .seconds(1)

    public var onAssistantMessage: (@MainActor (_ text: String, _ toolCalls: [ToolCallInfo], _ order: [StreamItemKind]) -> Void)?
    public var onReconnected: (@MainActor () async -> Void)?
    public var onConfirmationResolved: (@MainActor (_ toolCallId: String, _ action: String) -> Void)?

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
            self._flushTask?.cancel()
            self._flushTask = nil
            self._textBuffer = ""
            self._chunkCount = 0
            self.streamedText = ""
            self.streamOrder = []
            self.pendingConfirmations = []
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

    public func sendMessage(sessionId: String, content: String) async {
        logger.info("sendMessage: sessionId=\(sessionId), isConnected=\(self.isConnected)")
        // Reset per-run state on MainActor so @Observable triggers SwiftUI updates
        await MainActor.run {
            self._flushTask?.cancel()
            self._flushTask = nil
            self._textBuffer = ""
            self._chunkCount = 0
            self.streamedText = ""
            self.streamOrder = []
            self.pendingConfirmations = []
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
                if !streamOrder.contains(.text) {
                    streamOrder.append(.text)
                }
                _textBuffer += payload.text
                _chunkCount += 1
                if _chunkCount >= maxChunks {
                    flushBuffer()
                } else {
                    scheduleFlush()
                }
                logger.debug("textDelta: chunks=\(self._chunkCount), buffer=\(self._textBuffer.count), isStreaming=\(self.isStreaming)")

            case let .toolCall(payload):
                logger.info("toolCall: \(payload.toolName) id=\(payload.toolCallId)")
                streamOrder.append(.toolCall(payload.toolCallId))
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
                // Update the corresponding tool call status so streaming badges show "Needs Confirmation"
                if let index = toolCalls.firstIndex(where: { $0.toolCallId == payload.toolCallId }) {
                    toolCalls[index].status = .pendingConfirmation
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
                onConfirmationResolved?(payload.toolCallId, payload.action)

            case let .compacting(payload):
                logger.info("compacting: messageCount=\(payload.messageCount ?? 0)")
                isCompacting = true

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
    private func scheduleFlush() {
        // Cancel previous idle timer and restart — flush after 1s of silence
        _flushTask?.cancel()
        _flushTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: self?.idleFlushDelay ?? .seconds(1))
            guard let self, !Task.isCancelled else { return }
            self.flushBuffer()
        }
    }

    @MainActor
    private func flushBuffer() {
        _flushTask?.cancel()
        _flushTask = nil
        if !_textBuffer.isEmpty {
            streamedText += _textBuffer
            _textBuffer = ""
        }
        _chunkCount = 0
    }

    @MainActor
    private func finalizeResponse() {
        // Flush any remaining buffered text immediately
        _flushTask?.cancel()
        flushBuffer()

        logger
            .info(
                "finalizeResponse: streamedText.count=\(self.streamedText.count), toolCalls.count=\(self.toolCalls.count), hasCallback=\(self.onAssistantMessage != nil)"
            )
        if !streamedText.isEmpty || !toolCalls.isEmpty {
            logger
                .info(
                    "finalizeResponse: calling onAssistantMessage with text=\(self.streamedText.prefix(100)), toolCalls=\(self.toolCalls.count)"
                )
            onAssistantMessage?(streamedText, toolCalls, streamOrder)
        }
        streamedText = ""
        toolCalls = []
        streamOrder = []
        // Don't clear pendingConfirmations — they must persist until resolved
        isCompacting = false
        isStreaming = false
    }
}

// MARK: - Stream Item Kind

public enum StreamItemKind: Equatable, Sendable {
    case text
    case toolCall(String) // toolCallId
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
