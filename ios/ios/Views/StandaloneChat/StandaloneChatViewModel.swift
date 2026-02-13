import AssistantCore
import os
import SwiftUI

private let logger = Logger(subsystem: "lindaAssistant", category: "ChatTab")
private let lastSelectedAssigneeKey = "lastSelectedAssigneeId"

@Observable
final class ChatTabViewModel {
    var assignees: [Assignee] = []
    var selectedAssignee: Assignee?
    var displayMessages: [DisplayMessage] = []
    var isLoading = false
    var isLoadingMore = false
    var hasMoreMessages = false
    var error: String?
    var streamHandler: ChatStreamHandler?
    var showingConfirmation = false
    var showingAssigneeSheet = false
    var hasSession = false

    var displayError: String? {
        streamHandler?.error ?? error
    }

    func clearError() {
        streamHandler?.clearError()
        error = nil
    }

    private var nextCursor: String?

    // MARK: - Initial Load

    func load(
        apiClient: APIClient,
        authManager: AuthManager,
        eventManager: EventManager
    ) async {
        isLoading = true
        let loadingStartTime = ContinuousClock.now

        do {
            let response = try await apiClient.listAssignees(limit: 100)
            assignees = response.data

            // Restore last selected assignee from storage, or default to first
            let lastAssigneeId = UserDefaults.standard.string(forKey: lastSelectedAssigneeKey)
            logger.debug("Attempting to restore assignee. Saved ID: \(lastAssigneeId ?? "nil"), Available IDs: \(self.assignees.map { $0.id })")
            if let lastId = lastAssigneeId,
               let savedAssignee = self.assignees.first(where: { $0.id == lastId })
            {
                logger.debug("Restored saved assignee: \(savedAssignee.name)")
                selectedAssignee = savedAssignee
            } else {
                logger.debug("No saved assignee found, using first: \(self.assignees.first?.name ?? "none")")
                selectedAssignee = assignees.first
            }

            if let assignee = selectedAssignee {
                setupStreamHandler(apiClient: apiClient, authManager: authManager, eventManager: eventManager)
                await loadMessages(assigneeId: assignee.id, apiClient: apiClient)
            }
        } catch {
            logger.error("load error: \(error)")
            self.error = error.localizedDescription
        }

        let elapsed = ContinuousClock.now - loadingStartTime
        let minimumDuration = Duration.seconds(1)
        if elapsed < minimumDuration {
            try? await Task.sleep(for: minimumDuration - elapsed)
        }

        isLoading = false

        // Connect stream after loading completes (only if session exists)
        if hasSession, let assignee = selectedAssignee {
            await streamHandler?.connectByAssignee(assigneeId: assignee.id)
        }
    }

    // MARK: - Message Loading

    private func loadMessages(assigneeId: String, apiClient: APIClient) async {
        do {
            let response = try await apiClient.getChatMessages(assigneeId: assigneeId)
            hasSession = true
            nextCursor = response.nextCursor
            hasMoreMessages = response.nextCursor != nil
            displayMessages = convertMessages(response.messages, assigneeName: selectedAssignee?.name)
            // Extract pending confirmation from message data (no separate API call)
            await extractPendingConfirmation(from: response.messages)
        } catch let apiError as APIError {
            if case .notFound = apiError {
                // No session yet — show empty state
                hasSession = false
                displayMessages = []
                nextCursor = nil
                hasMoreMessages = false
            } else {
                logger.error("loadMessages error: \(apiError)")
                error = apiError.localizedDescription
            }
        } catch {
            logger.error("loadMessages error: \(error)")
            self.error = error.localizedDescription
        }
    }

    func loadOlderMessages(apiClient: APIClient) async {
        guard let assignee = selectedAssignee, let cursor = nextCursor, !isLoadingMore else { return }

        isLoadingMore = true
        do {
            let response = try await apiClient.getChatMessages(
                assigneeId: assignee.id,
                limit: 100,
                before: cursor
            )
            nextCursor = response.nextCursor
            hasMoreMessages = response.nextCursor != nil
            let older = convertMessages(response.messages, assigneeName: assignee.name)
            displayMessages.insert(contentsOf: older, at: 0)
        } catch {
            logger.error("loadOlderMessages error: \(error)")
            self.error = error.localizedDescription
        }
        isLoadingMore = false
    }

    // MARK: - Stream Handler

    private func setupStreamHandler(
        apiClient: APIClient,
        authManager: AuthManager,
        eventManager: EventManager
    ) {
        let handler = ChatStreamHandler(
            apiClient: apiClient,
            sseClient: SSEClient(authManager: authManager),
            eventManager: eventManager
        )
        handler.onAssistantMessage = { [weak self] text, toolCalls in
            guard let self else { return }
            let name = selectedAssignee?.name
            if !toolCalls.isEmpty {
                let toolMsg = DisplayMessage(
                    id: "assistant-tools-\(displayMessages.count)",
                    role: .assistant,
                    content: "",
                    toolCalls: toolCalls,
                    assigneeName: name
                )
                displayMessages.append(toolMsg)
            }
            if !text.isEmpty {
                let textMsg = DisplayMessage(
                    id: "assistant-\(displayMessages.count)",
                    role: .assistant,
                    content: text,
                    assigneeName: name
                )
                displayMessages.append(textMsg)
            }
        }
        streamHandler = handler
    }

    // MARK: - Send Message

    func sendMessage(
        _ content: String,
        apiClient: APIClient,
        authManager: AuthManager,
        eventManager: EventManager
    ) async {
        guard let assignee = selectedAssignee else { return }

        let userMsg = DisplayMessage(
            id: "user-\(displayMessages.count)",
            role: .user,
            content: content
        )
        displayMessages.append(userMsg)

        // If no session yet, set up stream handler and connect after sending
        let needsConnect = !hasSession
        if streamHandler == nil {
            setupStreamHandler(apiClient: apiClient, authManager: authManager, eventManager: eventManager)
        }

        await streamHandler?.sendChatMessage(assigneeId: assignee.id, content: content)

        if needsConnect {
            hasSession = true
            await streamHandler?.connectByAssignee(assigneeId: assignee.id)
        }
    }

    // MARK: - Assignee Switching

    func switchAssignee(
        _ assignee: Assignee,
        apiClient: APIClient,
        authManager: AuthManager,
        eventManager: EventManager
    ) async {
        guard assignee.id != selectedAssignee?.id else { return }

        streamHandler?.disconnect()
        streamHandler = nil
        selectedAssignee = assignee

        // Persist the user's selection
        logger.debug("Saving selected assignee ID: \(assignee.id) for key: \(lastSelectedAssigneeKey)")
        UserDefaults.standard.set(assignee.id, forKey: lastSelectedAssigneeKey)
        UserDefaults.standard.synchronize()
        displayMessages = []
        nextCursor = nil
        hasMoreMessages = false
        hasSession = false
        isLoading = true

        setupStreamHandler(apiClient: apiClient, authManager: authManager, eventManager: eventManager)
        await loadMessages(assigneeId: assignee.id, apiClient: apiClient)

        isLoading = false

        if hasSession {
            await streamHandler?.connectByAssignee(assigneeId: assignee.id)
        }
    }

    // MARK: - Clear Messages

    func clearMessages(apiClient: APIClient) async {
        guard let assignee = selectedAssignee else { return }
        do {
            try await apiClient.clearChatMessages(assigneeId: assignee.id)
            // Animate message removal
            await MainActor.run {
                withAnimation(.easeInOut(duration: 0.3)) {
                    displayMessages = []
                }
            }
            nextCursor = nil
            hasMoreMessages = false
            hasSession = false
            streamHandler?.disconnect()
            streamHandler = nil
        } catch {
            logger.error("clearMessages error: \(error)")
            self.error = error.localizedDescription
        }
    }

    // MARK: - Confirmation

    /// Scan messages for a pending confirmation and set it on the stream handler.
    private func extractPendingConfirmation(from messages: [ChatMessage]) async {
        for msg in messages {
            for tc in msg.toolCalls where tc.confirmation?.status == "pending" {
                let payload = ConfirmationPayload(
                    confirmationId: tc.confirmation!.id,
                    toolCallId: tc.toolCallId,
                    toolName: tc.toolName,
                    parameters: tc.input
                )
                logger.info("extractPendingConfirmation: found pending confirmation id=\(payload.confirmationId), toolName=\(payload.toolName)")
                await MainActor.run {
                    self.streamHandler?.setPendingConfirmation(payload)
                    self.showingConfirmation = true
                }
                return
            }
        }
    }

    // MARK: - Event Subscription

    func subscribeToEvents(eventManager: EventManager) async {
        for await event in eventManager.stream {
            switch event {
            case .assigneeCreated(let assignee):
                assignees.append(assignee)
                if selectedAssignee == nil {
                    selectedAssignee = assignee
                }
            case .assigneeUpdated(let updated):
                if let idx = assignees.firstIndex(where: { $0.id == updated.id }) {
                    assignees[idx] = updated
                }
                if selectedAssignee?.id == updated.id {
                    selectedAssignee = updated
                }
            case .assigneeDeleted(let id):
                assignees.removeAll { $0.id == id }
                if selectedAssignee?.id == id {
                    selectedAssignee = assignees.first
                }
            default:
                break
            }
        }
    }

    // MARK: - Cleanup

    func disconnect() {
        streamHandler?.disconnect()
    }

    // MARK: - Helpers

    private func convertMessages(_ messages: [ChatMessage], assigneeName: String?) -> [DisplayMessage] {
        messages.enumerated().compactMap { index, msg in
            let historicalToolCalls = msg.toolCalls.map { tc in
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
            guard (msg.textContent != nil && !msg.textContent!.isEmpty) || !historicalToolCalls.isEmpty
            else { return nil }
            return DisplayMessage(
                id: "history-\(index)-\(msg.role)",
                role: msg.role == "user" ? .user : .assistant,
                content: msg.textContent ?? "",
                toolCalls: historicalToolCalls,
                assigneeName: msg.role == "user" ? nil : assigneeName
            )
        }
    }
}
