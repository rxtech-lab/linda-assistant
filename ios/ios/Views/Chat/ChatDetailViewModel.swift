import SwiftUI
import AssistantCore

@Observable
final class ChatDetailViewModel {
    var session: ChatSession?
    var displayMessages: [DisplayMessage] = []
    var isLoading = false
    var error: String?
    var streamHandler: ChatStreamHandler?

    func loadSession(id: String, apiClient: APIClient, authManager: AuthManager, eventManager: EventManager) async {
        isLoading = true
        streamHandler = ChatStreamHandler(
            apiClient: apiClient,
            sseClient: SSEClient(authManager: authManager),
            eventManager: eventManager
        )

        do {
            let session = try await apiClient.getChatSession(id: id)
            self.session = session
            self.displayMessages = session.messages.enumerated().map { index, msg in
                DisplayMessage(
                    id: "\(index)-\(msg.role)",
                    role: msg.role == "user" ? .user : .assistant,
                    content: msg.content ?? ""
                )
            }
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    func sendMessage(_ content: String, sessionId: String, apiClient: APIClient) async {
        guard let streamHandler else { return }

        let userMsg = DisplayMessage(
            id: "user-\(displayMessages.count)",
            role: .user,
            content: content
        )
        displayMessages.append(userMsg)

        await streamHandler.sendMessageAndStream(sessionId: sessionId, content: content)

        if !streamHandler.streamedText.isEmpty {
            let assistantMsg = DisplayMessage(
                id: "assistant-\(displayMessages.count)",
                role: .assistant,
                content: streamHandler.streamedText
            )
            displayMessages.append(assistantMsg)
        }
    }
}
