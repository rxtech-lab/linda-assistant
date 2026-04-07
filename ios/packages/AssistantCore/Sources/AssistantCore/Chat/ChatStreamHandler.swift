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
    public var pendingConfirmation: ConfirmationPayload? {
        pendingConfirmations.first
    }

    public private(set) var pendingQuestions: [QuestionPayload] = []
    /// The first unresolved question in the queue (what the UI should show).
    public var pendingQuestion: QuestionPayload? {
        pendingQuestions.first
    }

    public private(set) var pendingLocations: [LocationRequestPayload] = []
    /// The first unresolved location request in the queue (what the UI should show).
    public var pendingLocation: LocationRequestPayload? {
        pendingLocations.first
    }

    public private(set) var pendingUploads: [UploadRequestPayload] = []
    /// The first unresolved upload request in the queue (what the UI should show).
    public var pendingUpload: UploadRequestPayload? {
        pendingUploads.first
    }

    public private(set) var error: String?
    /// Tracks whether a `done` event was received for the current run.
    /// Used to skip redundant `onReconnected` refetches after stream closes.
    @ObservationIgnored private var hasReceivedDone = false

    /// Device token for the current device, used to identify which device sent the last message.
    public var deviceToken: String?

    /// Computed: extract tool calls from streaming parts (for confirmation lookup).
    public var streamingToolCalls: [ToolCallInfo] {
        streamingParts.compactMap { if case let .tool(info) = $0 { info } else { nil } }
    }

    // Text buffering: accumulate chunks and flush on a 0.5s throttle
    @ObservationIgnored private var _textBuffer = ""
    @ObservationIgnored private var _flushTask: Task<Void, Never>?
    @ObservationIgnored private let flushInterval: Duration = .milliseconds(500)

    @ObservationIgnored private var _highestSeq: Int = 0

    public var onAssistantMessage: (@MainActor (_ parts: [MessagePart]) -> Void)?
    public var onReconnected: (@MainActor () async -> Void)?
    public var onDone: (@MainActor () async -> Void)?
    public var onConfirmationResolved: (@MainActor (_ toolCallId: String, _ action: String) -> Void)?
    public var onQuestionAnswered: (@MainActor (_ toolCallId: String, _ action: String) -> Void)?
    public var onLocationResolved: (@MainActor (_ toolCallId: String, _ action: String) -> Void)?
    public var onUploadResolved: (@MainActor (_ toolCallId: String, _ action: String) -> Void)?
    public var onToolResult: (@MainActor (_ toolCallId: String, _ isError: Bool, _ errorMessage: String?) -> Void)?
    /// Check whether a toolCallId already exists in display messages (historical tool calls).
    /// When true, the handler skips adding to streamingParts so tool-result falls through to onToolResult.
    public var isToolCallInHistory: (@MainActor (_ toolCallId: String) -> Bool)?
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
        let path = "chat/\(assigneeId)/stream"
        await connectToPath(path, queryItems: deviceTokenQueryItems)
    }

    public func connect(sessionId: String) async {
        let path = "chat-sessions/\(sessionId)/stream"
        await connectToPath(path, queryItems: deviceTokenQueryItems)
    }

    private var deviceTokenQueryItems: [URLQueryItem]? {
        guard let token = deviceToken else { return nil }
        return [URLQueryItem(name: "deviceToken", value: token)]
    }

    @discardableResult
    public func sendChatMessage(assigneeId: String, content: String) async -> String? {
        logger.info("sendChatMessage: assigneeId=\(assigneeId), isConnected=\(self.isConnected)")
        hasReceivedDone = false
        await MainActor.run {
            self._flushTask?.cancel()
            self._flushTask = nil
            self._textBuffer = ""
            self.streamingParts = []
            self.pendingConfirmations = []
            self.pendingQuestions = []
            self.pendingLocations = []
            self.pendingUploads = []
            self.error = nil
            self.isStreaming = true
        }
        eventManager.emit(.streamContentUpdated)

        do {
            let response = try await apiClient.sendChatMessage(
                assigneeId: assigneeId,
                SendMessage(content: content, deviceToken: deviceToken)
            )
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

    private func connectToPath(_ path: String, queryItems: [URLQueryItem]? = nil) async {
        guard !isConnected else {
            logger.info("connect: already connected")
            return
        }

        do {
            let request = try await apiClient.buildSSERequest(path: path, queryItems: queryItems)
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
                        let seq = event.seq
                        let message = event.parse()
                        logger
                            .debug(
                                "SSE event: type=\(event.type.rawValue) seq=\(seq.map(String.init) ?? "nil") data=\(event.data.prefix(100))"
                            )
                        await handleEvent(message, seq: seq)
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
        hasReceivedDone = false
        // Reset per-run state on MainActor so @Observable triggers SwiftUI updates
        await MainActor.run {
            self._flushTask?.cancel()
            self._flushTask = nil
            self._textBuffer = ""
            self.streamingParts = []
            self.pendingConfirmations = []
            self.pendingQuestions = []
            self.pendingLocations = []
            self.pendingUploads = []
            self.error = nil
            self.isStreaming = true
        }
        eventManager.emit(.streamContentUpdated)

        do {
            let response = try await apiClient.sendMessage(
                sessionId: sessionId,
                SendMessage(content: content, deviceToken: deviceToken)
            )
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

    public func answerQuestion(questionId: String, action: String, answers: [[String: AnyCodable]]? = nil) async {
        do {
            let body = AnswerQuestion(action: action, answers: answers)
            let response = try await apiClient.answerQuestion(id: questionId, body)
            await MainActor.run {
                pendingQuestions.removeAll { $0.questionId == questionId }
            }
            eventManager.emit(.questionAnswered(response.questionId, response.action))
        } catch {
            self.error = error.localizedDescription
        }
    }

    public func resolveLocation(
        toolCallId: String,
        action: String,
        latitude: Double? = nil,
        longitude: Double? = nil,
        accuracy: Double? = nil,
        alwaysAllow: Bool = false
    ) async {
        do {
            let body = LocationResponse(
                toolCallId: toolCallId,
                action: action,
                latitude: latitude,
                longitude: longitude,
                accuracy: accuracy,
                alwaysAllow: alwaysAllow ? true : nil
            )
            let response = try await apiClient.sendLocationResponse(body)
            await MainActor.run {
                pendingLocations.removeAll { $0.toolCallId == toolCallId }
            }
            eventManager.emit(.locationResolved(response.toolCallId, response.action))
        } catch {
            self.error = error.localizedDescription
        }
    }

    public func resolveUpload(uploadId: String, action: String, uploadedKeys: [String]? = nil) async {
        do {
            let body = ResolveUpload(action: action, uploadedKeys: uploadedKeys)
            let response = try await apiClient.resolveUpload(id: uploadId, body)
            await MainActor.run {
                pendingUploads.removeAll { $0.uploadId == uploadId }
            }
            eventManager.emit(.uploadResolved(response.uploadId, response.action))
        } catch {
            self.error = error.localizedDescription
        }
    }

    @MainActor
    public func removePendingUpload(uploadId: String) {
        pendingUploads.removeAll { $0.uploadId == uploadId }
    }

    @MainActor
    public func setPendingUpload(_ payload: UploadRequestPayload) {
        if !pendingUploads.contains(where: { $0.uploadId == payload.uploadId }) {
            pendingUploads.append(payload)
        }
    }

    @MainActor
    public func setPendingUploads(_ payloads: [UploadRequestPayload]) {
        pendingUploads = payloads
    }

    @MainActor
    public func setPendingLocation(_ payload: LocationRequestPayload) {
        if !pendingLocations.contains(where: { $0.toolCallId == payload.toolCallId }) {
            pendingLocations.append(payload)
        }
    }

    @MainActor
    public func setPendingLocations(_ payloads: [LocationRequestPayload]) {
        pendingLocations = payloads
    }

    @MainActor
    public func setPendingQuestion(_ payload: QuestionPayload) {
        if !pendingQuestions.contains(where: { $0.questionId == payload.questionId }) {
            pendingQuestions.append(payload)
        }
    }

    @MainActor
    public func setPendingQuestions(_ payloads: [QuestionPayload]) {
        pendingQuestions = payloads
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
    private func handleEvent(_ message: SSEMessage, seq: Int? = nil) {
        // Track reconnection transitions
        if case .reconnecting = message {
            isReconnecting = true
        } else if isReconnecting {
            // First real event after reconnecting -> we're back
            isReconnecting = false
            logger.info("handleEvent: reconnected, calling onReconnected")
            Task { await onReconnected?() }
        }

        // Seq-based dedup: skip events already processed
        if let seq, seq > 0 {
            if seq <= _highestSeq {
                logger.debug("handleEvent: skipping duplicate seq=\(seq) <= highestSeq=\(self._highestSeq)")
                return
            }
            _highestSeq = seq
        }

        switch message {
            case .reconnecting:
                logger.info("handleEvent: reconnecting...")
                // Reset streaming state so replayed chunks rebuild cleanly
                _flushTask?.cancel()
                _flushTask = nil
                _textBuffer = ""
                streamingParts = []
                _highestSeq = 0
                hasReceivedDone = false

            case let .thinkingStart(payload):
                logger.info("thinkingStart: id=\(payload.id)")
                if !isStreaming { isStreaming = true }
                streamingParts.append(.thinking(ThinkingInfo(text: "", isStreaming: true)))
                eventManager.emit(.streamContentUpdated)

            case let .thinkingStop(payload):
                logger.info("thinkingStop: id=\(payload.id) textLen=\(payload.text.count)")
                if let index = streamingParts.lastIndex(where: {
                    if case .thinking = $0 { return true }
                    return false
                }) {
                    streamingParts[index] = .thinking(ThinkingInfo(text: payload.text, isStreaming: false))
                }
                eventManager.emit(.streamContentUpdated)

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
                // Flush any buffered text BEFORE appending the tool call so text appears above the tool
                flushBuffer()
                if let index = streamingParts.firstIndex(where: {
                    if case let .tool(info) = $0 { return info.toolCallId == payload.toolCallId }
                    return false
                }) {
                    // Re-emitted after confirmation — update status back to running
                    if case var .tool(info) = streamingParts[index] {
                        info.status = .running
                        streamingParts[index] = .tool(info)
                    }
                } else if isToolCallInHistory?(payload.toolCallId) == true {
                    // Re-emitted for historical tool call already in displayMessages — skip adding
                    // to streamingParts so tool-result falls through to onToolResult callback
                    logger.info("toolCall: \(payload.toolCallId) already in history, skipping streamingParts")
                } else {
                    let info = ToolCallInfo(
                        toolCallId: payload.toolCallId,
                        toolName: payload.toolName,
                        input: payload.input,
                        status: .running
                    )
                    streamingParts.append(.tool(info))
                    eventManager.emit(.streamContentUpdated)
                }

            case let .toolResult(payload):
                logger.info("toolResult: toolCallId=\(payload.toolCallId), isError=\(payload.isError ?? false)")
                if let index = streamingParts.firstIndex(where: {
                    if case let .tool(info) = $0 { return info.toolCallId == payload.toolCallId }
                    return false
                }) {
                    if case var .tool(info) = streamingParts[index] {
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
                    if case let .tool(info) = $0 { return info.toolCallId == payload.toolCallId }
                    return false
                }) {
                    if case var .tool(info) = streamingParts[index] {
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
                    if case let .tool(info) = $0 { return info.toolCallId == payload.toolCallId }
                    return false
                }) {
                    if case var .tool(info) = streamingParts[index] {
                        info.status = payload.action == "rejected" ? .rejected : .running
                        streamingParts[index] = .tool(info)
                    }
                }
                onConfirmationResolved?(payload.toolCallId, payload.action)

            case let .questionRequired(payload):
                logger.info("questionRequired: \(payload.toolName) id=\(payload.questionId)")
                // Update the corresponding tool call status
                if let index = streamingParts.firstIndex(where: {
                    if case let .tool(info) = $0 { return info.toolCallId == payload.toolCallId }
                    return false
                }) {
                    if case var .tool(info) = streamingParts[index] {
                        info.status = .pendingQuestion
                        streamingParts[index] = .tool(info)
                    }
                }
                // Avoid duplicates from SSE replay
                if !pendingQuestions.contains(where: { $0.questionId == payload.questionId }) {
                    pendingQuestions.append(payload)
                }

            case let .questionAnswered(payload):
                logger
                    .info(
                        "questionAnswered: \(payload.toolName) id=\(payload.questionId) action=\(payload.action)"
                    )
                pendingQuestions.removeAll { $0.questionId == payload.questionId }
                // Immediate feedback: update streaming tool call status
                if let index = streamingParts.firstIndex(where: {
                    if case let .tool(info) = $0 { return info.toolCallId == payload.toolCallId }
                    return false
                }) {
                    if case var .tool(info) = streamingParts[index] {
                        if payload.action == "rejected" {
                            info.status = .rejected
                        } else if payload.action == "answered" {
                            info.status = .completed
                        } else {
                            info.status = .running
                        }
                        streamingParts[index] = .tool(info)
                    }
                }
                onQuestionAnswered?(payload.toolCallId, payload.action)

            case let .locationRequired(payload):
                logger
                    .info(
                        "locationRequired: \(payload.toolName) toolCallId=\(payload.toolCallId) isAutoConfirm=\(String(describing: payload.isAutoConfirm))"
                    )
                logger
                    .info(
                        "locationRequired raw payload: toolName=\(payload.toolName) reason=\(payload.reason ?? "nil") isAutoConfirm=\(String(describing: payload.isAutoConfirm))"
                    )
                // Update the corresponding tool call status
                if let index = streamingParts.firstIndex(where: {
                    if case let .tool(info) = $0 { return info.toolCallId == payload.toolCallId }
                    return false
                }) {
                    if case var .tool(info) = streamingParts[index] {
                        info.status = .pendingLocation
                        streamingParts[index] = .tool(info)
                    }
                }

                if payload.isAutoConfirm == true {
                    // Auto-confirm: silently get location and respond without showing sheet
                    let toolCallId = payload.toolCallId
                    Task { [weak self] in
                        guard let self else { return }
                        let locationService = LocationService()
                        do {
                            let location = try await locationService.requestLocation()
                            await resolveLocation(
                                toolCallId: toolCallId,
                                action: "confirm",
                                latitude: location.latitude,
                                longitude: location.longitude,
                                accuracy: location.accuracy
                            )
                        } catch {
                            logger.error("Auto-confirm location failed: \(error)")
                            await resolveLocation(
                                toolCallId: toolCallId,
                                action: "reject"
                            )
                        }
                    }
                } else {
                    // Manual: show location sheet
                    if !pendingLocations.contains(where: { $0.toolCallId == payload.toolCallId }) {
                        pendingLocations.append(payload)
                    }
                }

            case let .locationResolved(payload):
                logger
                    .info(
                        "locationResolved: \(payload.toolName) toolCallId=\(payload.toolCallId) action=\(payload.action)"
                    )
                pendingLocations.removeAll { $0.toolCallId == payload.toolCallId }
                // Immediate feedback: update streaming tool call status
                if let index = streamingParts.firstIndex(where: {
                    if case let .tool(info) = $0 { return info.toolCallId == payload.toolCallId }
                    return false
                }) {
                    if case var .tool(info) = streamingParts[index] {
                        info.status = payload.action == "rejected" ? .rejected : .running
                        streamingParts[index] = .tool(info)
                    }
                }
                onLocationResolved?(payload.toolCallId, payload.action)

            case let .uploadRequired(payload):
                logger.info("uploadRequired: \(payload.toolName) id=\(payload.uploadId)")
                // Update the corresponding tool call status
                if let index = streamingParts.firstIndex(where: {
                    if case let .tool(info) = $0 { return info.toolCallId == payload.toolCallId }
                    return false
                }) {
                    if case var .tool(info) = streamingParts[index] {
                        info.status = .pendingUpload
                        info.uploadId = payload.uploadId
                        streamingParts[index] = .tool(info)
                    }
                }
                // Avoid duplicates from SSE replay
                if !pendingUploads.contains(where: { $0.uploadId == payload.uploadId }) {
                    pendingUploads.append(payload)
                }

            case let .uploadResolved(payload):
                logger
                    .info(
                        "uploadResolved: \(payload.toolName) id=\(payload.uploadId) action=\(payload.action)"
                    )
                pendingUploads.removeAll { $0.uploadId == payload.uploadId }
                // Immediate feedback: update streaming tool call status
                if let index = streamingParts.firstIndex(where: {
                    if case let .tool(info) = $0 { return info.toolCallId == payload.toolCallId }
                    return false
                }) {
                    if case var .tool(info) = streamingParts[index] {
                        if payload.action == "rejected" {
                            info.status = .rejected
                        } else if payload.action == "completed" {
                            info.status = .completed
                        } else {
                            info.status = .running
                        }
                        streamingParts[index] = .tool(info)
                    }
                }
                onUploadResolved?(payload.toolCallId, payload.action)

            case let .toolProgress(payload):
                logger
                    .info(
                        "toolProgress: \(payload.toolName) toolCallId=\(payload.toolCallId) \(payload.current)/\(payload.total) step=\(payload.step ?? "nil")"
                    )
                if let index = streamingParts.firstIndex(where: {
                    if case let .tool(info) = $0 { return info.toolCallId == payload.toolCallId }
                    return false
                }) {
                    if case var .tool(info) = streamingParts[index] {
                        info.progressCurrent = payload.current
                        info.progressTotal = payload.total
                        info.progressStep = payload.step
                        info.progressMessage = payload.message
                        // Only set the thumbnail once (keep the first rendered slide)
                        if info.progressThumbnailUrl == nil, let url = payload.thumbnailUrl {
                            info.progressThumbnailUrl = url
                        }
                        streamingParts[index] = .tool(info)
                    }
                }
                eventManager.emit(.streamContentUpdated)

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
                hasReceivedDone = true
                finalizeResponse()

            case .refresh:
                logger.info("refresh: server indicates new data available, triggering refetch")
                Task { await onReconnected?() }

            case let .status(payload):
                logger.info("status: \(payload.status)")
                if payload.status == "in_progress" {
                    isStreaming = true
                } else if payload.status == "stopped" {
                    finalizeResponse()
                } else if payload.status == "waiting_confirmation" || payload.status == "waiting_question" || payload
                    .status == "waiting_location" || payload.status == "waiting_upload"
                {
                    // Agent paused for confirmation/question/upload — stop streaming indicator
                    // but keep streamingParts and pending items visible
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
            flushBuffer()
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
               case var .text(.streaming(chunks)) = streamingParts[lastIndex]
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
            // Convert streaming text parts to finalized plain text; finalize streaming thinking parts
            let finalizedParts = streamingParts.map { part -> MessagePart in
                if case let .text(content) = part {
                    return .text(.plain(content.displayText))
                }
                if case let .thinking(info) = part, info.isStreaming {
                    return .thinking(ThinkingInfo(text: info.text, isStreaming: false))
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

        // Notify view model that stream finished — trigger refetch for authoritative data
        if hasReceivedDone {
            Task { await onDone?() }
        }
    }
}

// MARK: - Message Part

public enum TextPartContent: Sendable {
    case plain(String)
    case streaming([String])

    public var displayText: String {
        switch self {
            case let .plain(s): s
            case let .streaming(chunks): chunks.joined()
        }
    }
}

public enum MessagePart: Sendable {
    case text(TextPartContent)
    case tool(ToolCallInfo)
    case thinking(ThinkingInfo)
}

// MARK: - Thinking Info

public struct ThinkingInfo: Sendable {
    public var text: String
    public var isStreaming: Bool

    public init(text: String, isStreaming: Bool) {
        self.text = text
        self.isStreaming = isStreaming
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
    public var uploadId: String?
    public var progressCurrent: Int?
    public var progressTotal: Int?
    public var progressStep: String?
    public var progressMessage: String?
    public var progressThumbnailUrl: String?

    public init(
        toolCallId: String,
        toolName: String,
        input: [String: AnyCodable]?,
        status: ToolCallStatus,
        result: AnyCodable? = nil,
        errorMessage: String? = nil,
        uploadId: String? = nil,
        progressCurrent: Int? = nil,
        progressTotal: Int? = nil,
        progressStep: String? = nil,
        progressMessage: String? = nil,
        progressThumbnailUrl: String? = nil
    ) {
        self.toolCallId = toolCallId
        self.toolName = toolName
        self.input = input
        self.status = status
        self.result = result
        self.errorMessage = errorMessage
        self.uploadId = uploadId
        self.progressCurrent = progressCurrent
        self.progressTotal = progressTotal
        self.progressStep = progressStep
        self.progressMessage = progressMessage
        self.progressThumbnailUrl = progressThumbnailUrl
    }
}

public enum ToolCallStatus: Sendable, Equatable {
    case running
    case completed
    case failed
    case pendingConfirmation
    case pendingQuestion
    case pendingLocation
    case pendingUpload
    case rejected
    case stoppedNoResult

    /// Map a confirmation status string to a ToolCallStatus.
    /// When `hasResult` is false and confirmation is "confirmed", returns `.stoppedNoResult`
    /// because the user approved the tool but no result was produced.
    public static func from(confirmation: ToolCallConfirmation?, hasResult: Bool = true) -> ToolCallStatus {
        guard let status = confirmation?.status else { return .completed }
        switch status {
            case "rejected": return .rejected
            case "pending": return .pendingConfirmation
            case "cancelled": return .stoppedNoResult
            default: return hasResult ? .completed : .stoppedNoResult
        }
    }

    /// Map a question status string to a ToolCallStatus.
    public static func from(question: ToolCallQuestion?, hasResult: Bool = true) -> ToolCallStatus {
        guard let status = question?.status else { return .completed }
        switch status {
            case "rejected": return .rejected
            case "pending": return .pendingQuestion
            case "cancelled": return .stoppedNoResult
            default: return hasResult ? .completed : .stoppedNoResult
        }
    }

    /// Map an upload status string to a ToolCallStatus.
    public static func from(upload: ToolCallUpload?, hasResult: Bool = true) -> ToolCallStatus {
        guard let status = upload?.status else { return .completed }
        switch status {
            case "rejected": return .rejected
            case "pending": return .pendingUpload
            case "cancelled": return .stoppedNoResult
            default: return hasResult ? .completed : .stoppedNoResult
        }
    }
}
