import AssistantCore
import SwiftUI

@Observable
final class ChatSessionListViewModel {
    var sessions: [SessionSummary] = []
    var isLoading = false
    var isLoadingMore = false
    var hasMore = true
    var error: String?

    private var offset = 0
    private let pageSize = 20

    func loadSessions(taskId: String, apiClient: APIClient, search: String = "") async {
        isLoading = true
        error = nil
        offset = 0
        do {
            let response = try await apiClient.listTaskChatSessions(
                taskId: taskId, limit: pageSize, offset: 0, search: search
            )
            sessions = response.data
            hasMore = response.pagination.hasMore
            offset = pageSize
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    func loadMore(taskId: String, apiClient: APIClient, search: String = "") async {
        guard !isLoadingMore, hasMore else { return }
        isLoadingMore = true
        do {
            let response = try await apiClient.listTaskChatSessions(
                taskId: taskId, limit: pageSize, offset: offset, search: search
            )
            sessions.append(contentsOf: response.data)
            hasMore = response.pagination.hasMore
            offset += pageSize
        } catch {
            self.error = error.localizedDescription
        }
        isLoadingMore = false
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
