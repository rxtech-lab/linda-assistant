import AssistantCore
import SwiftUI

@Observable
final class TaskBriefingListViewModel {
    var briefings: [BriefingSummary] = []
    var isLoading = false
    var isLoadingMore = false
    var hasMore = true
    var error: String?

    private var offset = 0
    private let pageSize = 20

    func loadBriefings(taskId: String, apiClient: APIClient, search: String = "") async {
        isLoading = true
        error = nil
        offset = 0
        do {
            let response = try await apiClient.listTaskBriefings(
                taskId: taskId, limit: pageSize, offset: 0, search: search
            )
            briefings = response.data
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
            let response = try await apiClient.listTaskBriefings(
                taskId: taskId, limit: pageSize, offset: offset, search: search
            )
            briefings.append(contentsOf: response.data)
            hasMore = response.pagination.hasMore
            offset += pageSize
        } catch {
            self.error = error.localizedDescription
        }
        isLoadingMore = false
    }
}
