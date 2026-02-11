import AssistantCore
import SwiftUI

@Observable
final class ChatSessionListViewModel {
    var sessions: [SessionSummary] = []
    var isLoading = false
    var error: String?

    func loadSessions(taskId: String, apiClient: APIClient) async {
        isLoading = true
        do {
            sessions = try await apiClient.listTaskChatSessions(taskId: taskId)
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    func deleteSessions(at offsets: IndexSet, apiClient: APIClient, eventManager: EventManager) async {
        for index in offsets {
            let session = sessions[index]
            do {
                try await apiClient.deleteChatSession(id: session.id)
                sessions.remove(at: index)
                eventManager.emit(.chatSessionDeleted(session.id))
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
