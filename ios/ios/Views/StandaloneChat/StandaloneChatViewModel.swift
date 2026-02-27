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
    var documents: [Document] = []
    var isLoading = false
    var isLoadingMore = false
    var hasMoreMessages = false
    var error: String?
    var streamHandler: ChatStreamHandler?
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
        error = nil
        let loadingStartTime = ContinuousClock.now

        do {
            let response = try await apiClient.listAssignees(limit: 100)
            assignees = response.data

            // Restore last selected assignee from storage, or default to first
            let lastAssigneeId = UserDefaults.standard.string(forKey: lastSelectedAssigneeKey)
            logger
                .debug(
                    "Attempting to restore assignee. Saved ID: \(lastAssigneeId ?? "nil"), Available IDs: \(self.assignees.map(\.id))"
                )
            if let lastId = lastAssigneeId,
               let savedAssignee = assignees.first(where: { $0.id == lastId })
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
        } catch is CancellationError {
            return
        } catch let urlError as URLError where urlError.code == .cancelled {
            return
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
            displayMessages = DisplayMessage.convert(from: response.messages, assigneeName: selectedAssignee?.name)
            // Extract pending confirmation from message data (no separate API call)
            await MainActor.run {
                extractPendingConfirmations(
                    from: response.messages,
                    streamHandler: streamHandler
                )
            }
            // Load documents for this assignee's chat session
            await loadDocuments(assigneeId: assigneeId, apiClient: apiClient)
        } catch is CancellationError {
            return
        } catch let urlError as URLError where urlError.code == .cancelled {
            return
        } catch let apiError as APIError {
            if case .notFound = apiError {
                // No session yet — show empty state
                hasSession = false
                displayMessages = []
                documents = []
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

    // MARK: - Document Loading

    private func loadDocuments(assigneeId: String, apiClient: APIClient) async {
        do {
            let response = try await apiClient.listChatDocuments(assigneeId: assigneeId)
            documents = response.data
        } catch {
            logger.error("loadDocuments error: \(error)")
            // Non-fatal — don't show error for documents failing to load
        }
    }

    func deleteDocument(id: String, apiClient: APIClient, eventManager: EventManager) async {
        do {
            try await apiClient.deleteDocument(id: id)
            documents.removeAll { $0.id == id }
            eventManager.emit(.documentDeleted(id))
        } catch {
            logger.error("deleteDocument error: \(error)")
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
            let older = DisplayMessage.convert(from: response.messages, assigneeName: assignee.name)
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
        handler.onAssistantMessage = { [weak self] parts in
            guard let self else { return }
            appendAssistantMessages(
                parts: parts,
                to: &displayMessages,
                assigneeName: selectedAssignee?.name
            )
        }
        handler.onConfirmationResolved = { [weak self] toolCallId, action in
            guard let self else { return }
            updateToolCallStatus(toolCallId: toolCallId, action: action, in: &displayMessages)
        }
        handler.onToolResult = { [weak self] toolCallId, isError, errorMessage in
            guard let self else { return }
            updateToolCallResult(toolCallId: toolCallId, isError: isError, errorMessage: errorMessage, in: &displayMessages)
        }
        handler.onUserMessage = { [weak self] id, content in
            guard let self else { return }
            // Dedup: skip if a message with this ID already exists (sent from this device)
            guard !displayMessages.contains(where: { $0.id == id }) else { return }
            let userMsg = DisplayMessage(
                id: id,
                role: .user,
                parts: [.text(.plain(content))]
            )
            displayMessages.append(userMsg)
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

        let tempId = "user-\(UUID().uuidString)"
        let userMsg = DisplayMessage(
            id: tempId,
            role: .user,
            parts: [.text(.plain(content))]
        )
        displayMessages.append(userMsg)

        // If no session yet, set up stream handler and connect after sending
        let needsConnect = !hasSession
        if streamHandler == nil {
            setupStreamHandler(apiClient: apiClient, authManager: authManager, eventManager: eventManager)
        }

        let messageId = await streamHandler?.sendChatMessage(assigneeId: assignee.id, content: content)
        // Update local message ID to backend ID for dedup when SSE event arrives
        if let messageId, let idx = displayMessages.firstIndex(where: { $0.id == tempId }) {
            displayMessages[idx] = DisplayMessage(
                id: messageId,
                role: displayMessages[idx].role,
                parts: displayMessages[idx].parts
            )
        }

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
        documents = []
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
                    documents = []
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

    // MARK: - Event Subscription

    func subscribeToEvents(eventManager: EventManager) async {
        for await event in eventManager.stream {
            switch event {
                case let .assigneeCreated(assignee):
                    assignees.append(assignee)
                    if selectedAssignee == nil {
                        selectedAssignee = assignee
                    }
                case let .assigneeUpdated(updated):
                    if let idx = assignees.firstIndex(where: { $0.id == updated.id }) {
                        assignees[idx] = updated
                    }
                    if selectedAssignee?.id == updated.id {
                        selectedAssignee = updated
                    }
                case let .assigneeDeleted(id):
                    assignees.removeAll { $0.id == id }
                    if selectedAssignee?.id == id {
                        selectedAssignee = assignees.first
                    }
                default:
                    break
            }
        }
    }

    // MARK: - Reconnection

    func reconnectIfNeeded(apiClient: APIClient) async {
        guard let streamHandler, !streamHandler.isConnected, hasSession,
              let assignee = selectedAssignee
        else { return }
        logger.info("reconnectIfNeeded: reloading messages and reconnecting SSE")
        await loadMessages(assigneeId: assignee.id, apiClient: apiClient)
        await streamHandler.connectByAssignee(assigneeId: assignee.id)
    }

    // MARK: - Cleanup

    func stopStream() async {
        guard let assignee = selectedAssignee, let streamHandler else { return }
        await streamHandler.stopChatStream(assigneeId: assignee.id)
    }

    func disconnect() {
        streamHandler?.disconnect()
    }
}
