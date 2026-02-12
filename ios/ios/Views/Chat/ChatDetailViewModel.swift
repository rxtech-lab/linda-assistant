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
            // Append tool-calls-only message first (so badge appears before text)
            if !toolCalls.isEmpty {
                let toolMsg = DisplayMessage(
                    id: "assistant-tools-\(displayMessages.count)",
                    role: .assistant,
                    content: "",
                    toolCalls: toolCalls,
                    assigneeName: assigneeName
                )
                displayMessages.append(toolMsg)
            }
            // Then append text message
            if !text.isEmpty {
                let textMsg = DisplayMessage(
                    id: "assistant-\(displayMessages.count)",
                    role: .assistant,
                    content: text,
                    assigneeName: assigneeName
                )
                displayMessages.append(textMsg)
            }
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

    private func loadPendingConfirmation(apiClient: APIClient, sessionId: String) async {
        do {
            let confirmations = try await apiClient.listConfirmations()
            if let pending = confirmations.first(where: { $0.chatSessionId == sessionId && $0.status == "pending" }) {
                let payload = ConfirmationPayload(
                    confirmationId: pending.id,
                    toolCallId: pending.toolCallId,
                    toolName: pending.toolName,
                    parameters: pending.parameters
                )
                await MainActor.run {
                    streamHandler?.setPendingConfirmation(payload)
                    // Mark the matching tool call in displayMessages as pendingConfirmation
                    for i in displayMessages.indices {
                        for j in displayMessages[i].toolCalls.indices {
                            if displayMessages[i].toolCalls[j].toolCallId == pending.toolCallId {
                                displayMessages[i].toolCalls[j].status = .pendingConfirmation
                            }
                        }
                    }
                    showingConfirmation = true
                }
            }
        } catch {
            logger.error("loadPendingConfirmation error: \(error)")
        }
    }

    private func fetchSession(id: String, apiClient: APIClient) async throws {
        logger.info("Fetching chat session...")
        let session = try await apiClient.getChatSession(id: id)
        logger.info("Session loaded: title=\(session.title ?? "nil"), raw messages count=\(session.messages.count)")
        self.session = session
        assigneeName = session.assignee?.name
        displayMessages = session.messages.enumerated().compactMap { index, msg in
            // Build tool call infos from historical messages
            let historicalToolCalls = msg.toolCalls.map { tc in
                // Error annotation takes precedence when no confirmation exists
                let status: ToolCallStatus
                let errorMsg: String?
                if tc.confirmation != nil {
                    status = ToolCallStatus.from(confirmation: tc.confirmation)
                    errorMsg = nil
                } else if tc.error != nil {
                    status = .failed
                    errorMsg = tc.error
                } else {
                    status = .completed
                    errorMsg = nil
                }
                return ToolCallInfo(
                    toolCallId: tc.toolCallId,
                    toolName: tc.toolName,
                    input: tc.input,
                    status: status,
                    errorMessage: errorMsg
                )
            }
            // Skip messages with no text and no tool calls
            guard (msg.textContent != nil && !msg.textContent!.isEmpty) || !historicalToolCalls.isEmpty
            else { return nil }
            return DisplayMessage(
                id: "\(index)-\(msg.role)",
                role: msg.role == "user" ? .user : .assistant,
                content: msg.textContent ?? "",
                toolCalls: historicalToolCalls,
                assigneeName: msg.role == "user" ? nil : assigneeName
            )
        }

        // If session is waiting for confirmation, load the pending confirmation
        if session.status == "waiting_confirmation" {
            await loadPendingConfirmation(apiClient: apiClient, sessionId: id)
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
