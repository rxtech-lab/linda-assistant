import AssistantCore
import os
import SwiftUI

private let logger = Logger(subsystem: "lindaAssistant", category: "ChatDetail")

@Observable
final class ChatDetailViewModel {
    var session: ChatSession?
    var displayMessages: [DisplayMessage] = []
    var isLoading = false
    var error: String?
    var streamHandler: ChatStreamHandler?
    var assigneeName: String?
    var cachedModels: [LanguageModel] = []

    var selectedModelSupportsImages: Bool {
        guard let modelId = session?.assignee?.model else { return true }
        return cachedModels.first(where: { $0.modelId == modelId })?.supportsImages ?? true
    }

    var displayError: String? {
        streamHandler?.error ?? error
    }

    func clearError() {
        streamHandler?.clearError()
        error = nil
    }

    func loadSession(
        id: String,
        apiClient: APIClient,
        authManager: AuthManager,
        eventManager: EventManager,
        deviceToken: String? = nil
    ) async {
        logger.info("loadSession started for id=\(id)")
        isLoading = true
        error = nil
        let loadingStartTime = ContinuousClock.now

        let handler = ChatStreamHandler(
            apiClient: apiClient,
            sseClient: SSEClient(authManager: authManager),
            eventManager: eventManager
        )
        handler.deviceToken = deviceToken
        handler.onAssistantMessage = { [weak self] parts in
            guard let self else { return }
            logger.info("onAssistantMessage received, parts=\(parts.count)")
            appendAssistantMessages(parts: parts, to: &displayMessages, assigneeName: assigneeName)
        }
        handler.onReconnected = { [weak self] in
            guard let self else { return }
            logger.info("onReconnected: refetching session \(id)")
            do {
                try await fetchSession(id: id, apiClient: apiClient)
            } catch {
                logger.error("onReconnected: fetch error: \(error)")
                self.error = error.localizedDescription
            }
        }
        handler.onDone = { [weak self] in
            guard let self else { return }
            logger.info("onDone: refetching session \(id)")
            do {
                try await fetchSession(id: id, apiClient: apiClient)
            } catch {
                logger.error("onDone: fetch error: \(error)")
            }
        }
        handler.onConfirmationResolved = { [weak self] toolCallId, action in
            guard let self else { return }
            updateToolCallStatus(toolCallId: toolCallId, action: action, in: &displayMessages)
        }
        handler.onQuestionAnswered = { [weak self] toolCallId, action in
            guard let self else { return }
            updateToolCallStatus(toolCallId: toolCallId, action: action, in: &displayMessages)
        }
        handler.onToolResult = { [weak self] toolCallId, isError, errorMessage in
            guard let self else { return }
            updateToolCallResult(
                toolCallId: toolCallId,
                isError: isError,
                errorMessage: errorMessage,
                in: &displayMessages
            )
        }
        handler.isToolCallInHistory = { [weak self] toolCallId in
            guard let self else { return false }
            return displayMessages.contains { msg in
                msg.parts.contains { part in
                    if case let .tool(info) = part { return info.toolCallId == toolCallId }
                    return false
                }
            }
        }
        handler.onUserMessage = { [weak self] id, content in
            guard let self else { return }
            // Dedup: skip if a message with this server ID already exists
            guard !displayMessages.contains(where: { $0.id == id }) else { return }
            // Match optimistic message (temp "user-" prefix) by content → update its ID
            if let idx = displayMessages.lastIndex(where: {
                $0.id.hasPrefix("user-") && $0.role == .user && $0.textContent == content
            }) {
                displayMessages[idx] = DisplayMessage(id: id, role: .user, parts: displayMessages[idx].parts)
                return
            }
            // Multi-device: message sent from another device
            let userMsg = DisplayMessage(
                id: id,
                role: .user,
                parts: [.text(.plain(content))]
            )
            displayMessages.append(userMsg)
        }
        streamHandler = handler

        do {
            try await fetchSession(id: id, apiClient: apiClient)

            // Fetch models separately — don't let it block session loading
            do {
                cachedModels = try await apiClient.listModels()
            } catch {
                logger.error("Failed to load models: \(error)")
            }
        } catch is CancellationError {
            return
        } catch let urlError as URLError where urlError.code == .cancelled {
            return
        } catch {
            logger.error("loadSession error: \(error)")
            self.error = error.localizedDescription
        }

        // Ensure minimum loading duration for smooth animation
        let elapsed = ContinuousClock.now - loadingStartTime
        let minimumDuration = Duration.seconds(1.5)
        if elapsed < minimumDuration {
            try? await Task.sleep(for: minimumDuration - elapsed)
        }

        isLoading = false

        logger.info("Connecting SSE...")
        await handler.connect(sessionId: id)
        logger.info("SSE connect returned, isConnected=\(handler.isConnected)")
    }

    func subscribeToEvents(eventManager: EventManager, apiClient: APIClient, sessionId: String) async {
        logger.info("subscribeToEvents: start for sessionId=\(sessionId)")
        if let event = eventManager.lastEvent {
            logger.info("subscribeToEvents: lastEvent=\(String(describing: event))")
            if case let .chatSessionCreated(session) = event, session.id == sessionId {
                do {
                    try await fetchSession(id: sessionId, apiClient: apiClient)
                } catch {
                    logger.error("subscribeToEvents preload error: \(error)")
                    self.error = error.localizedDescription
                }
            }
        }
        for await event in eventManager.stream {
            logger.info("subscribeToEvents: received event=\(String(describing: event))")
            switch event {
                case let .chatSessionCreated(session) where session.id == sessionId:
                    do {
                        try await fetchSession(id: sessionId, apiClient: apiClient)
                    } catch {
                        logger.error("subscribeToEvents reload error: \(error)")
                        self.error = error.localizedDescription
                    }
                default:
                    break
            }
        }
    }

    private func fetchSession(id: String, apiClient: APIClient) async throws {
        logger.info("Fetching chat session...")
        let session = try await apiClient.getChatSession(id: id)
        logger.info("Session loaded: title=\(session.title ?? "nil"), raw messages count=\(session.messages.count)")
        self.session = session
        assigneeName = session.assignee?.name
        displayMessages = DisplayMessage.convert(from: session.messages, assigneeName: assigneeName)

        // Extract pending confirmations from message data (no extra API call)
        logger
            .info(
                "fetchSession: session.status=\(session.status ?? "nil"), streamHandler=\(self.streamHandler != nil ? "set" : "nil")"
            )
        await MainActor.run {
            extractPendingConfirmations(
                from: session.messages,
                streamHandler: self.streamHandler
            )
        }
    }

    func sendMessage(_ content: String, sessionId: String, attachments: [MessageAttachment]? = nil) async {
        guard let streamHandler else {
            logger.warning("sendMessage: streamHandler is nil")
            return
        }

        logger
            .info(
                "sendMessage: \(content.prefix(50)), attachments=\(attachments?.count ?? 0), isConnected=\(streamHandler.isConnected)"
            )

        let tempId = "user-\(UUID().uuidString)"
        var messageParts: [MessagePart] = []
        // Add attachment parts first (shown above text bubble)
        if let attachments {
            for att in attachments {
                messageParts.append(.attachment(AttachmentInfo(
                    url: att.url,
                    isImage: att.type == "image",
                    mimeType: att.mimeType
                )))
            }
        }
        if !content.isEmpty {
            messageParts.append(.text(.plain(content)))
        }
        let userMsg = DisplayMessage(
            id: tempId,
            role: .user,
            parts: messageParts.isEmpty ? [.text(.plain(" "))] : messageParts
        )
        displayMessages.append(userMsg)

        let messageId = await streamHandler.sendMessage(
            sessionId: sessionId,
            content: content.isEmpty ? " " : content,
            attachments: attachments
        )
        // Update local message ID to backend ID for dedup when SSE event arrives
        if let messageId, let idx = displayMessages.firstIndex(where: { $0.id == tempId }) {
            displayMessages[idx] = DisplayMessage(
                id: messageId,
                role: displayMessages[idx].role,
                parts: displayMessages[idx].parts
            )
        }
        logger.info("sendMessage completed, isStreaming=\(streamHandler.isStreaming)")
    }

    func stopStream(sessionId: String) async {
        guard let streamHandler else { return }
        await streamHandler.stopStream(sessionId: sessionId)
    }

    func reconnectIfNeeded(sessionId: String, apiClient: APIClient) async {
        guard let streamHandler, !streamHandler.isConnected else { return }
        logger.info("reconnectIfNeeded: refetching session and reconnecting SSE")
        do {
            try await fetchSession(id: sessionId, apiClient: apiClient)
        } catch {
            logger.error("reconnectIfNeeded: fetch error: \(error)")
            self.error = error.localizedDescription
        }
        await streamHandler.connect(sessionId: sessionId)
    }

    func disconnect() {
        streamHandler?.disconnect()
    }
}
