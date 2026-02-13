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
    var showingConfirmation = false
    var assigneeName: String?

    var displayError: String? {
        streamHandler?.error ?? error
    }

    func clearError() {
        streamHandler?.clearError()
        error = nil
    }

    func loadSession(id: String, apiClient: APIClient, authManager: AuthManager, eventManager: EventManager) async {
        logger.info("loadSession started for id=\(id)")
        isLoading = true
        let loadingStartTime = ContinuousClock.now

        let handler = ChatStreamHandler(
            apiClient: apiClient,
            sseClient: SSEClient(authManager: authManager),
            eventManager: eventManager
        )
        handler.onAssistantMessage = { [weak self] text, toolCalls in
            guard let self else { return }
            logger.info("onAssistantMessage received, textLength=\(text.count), toolCalls=\(toolCalls.count)")
            appendAssistantMessages(text: text, toolCalls: toolCalls, to: &displayMessages, assigneeName: assigneeName)
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
        streamHandler = handler

        do {
            try await fetchSession(id: id, apiClient: apiClient)
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

        // Extract pending confirmation directly from message data (no extra API call)
        logger
            .info(
                "fetchSession: session.status=\(session.status ?? "nil"), streamHandler=\(self.streamHandler != nil ? "set" : "nil")"
            )
        if session.status == "waiting_confirmation" {
            await MainActor.run {
                extractPendingConfirmation(
                    from: session.messages,
                    streamHandler: streamHandler,
                    showingConfirmation: &showingConfirmation
                )
            }
        }
    }

    func sendMessage(_ content: String, sessionId: String) async {
        guard let streamHandler else {
            logger.warning("sendMessage: streamHandler is nil")
            return
        }

        logger.info("sendMessage: \(content.prefix(50)), isConnected=\(streamHandler.isConnected)")

        let userMsg = DisplayMessage(
            id: "user-\(displayMessages.count)",
            role: .user,
            content: content
        )
        displayMessages.append(userMsg)

        await streamHandler.sendMessage(sessionId: sessionId, content: content)
        logger.info("sendMessage completed, isStreaming=\(streamHandler.isStreaming)")
    }

    func disconnect() {
        streamHandler?.disconnect()
    }
}
