import AssistantCore
import SwiftUI

@Observable
final class HistoryListViewModel {
    var items: [TaskHistory] = []
    var isLoading = false
    var isLoadingMore = false
    var hasMore = true
    var error: String?

    private var offset = 0
    private let pageSize = 20

    func loadHistory(assigneeId: String? = nil, search: String? = nil, apiClient: APIClient) async {
        isLoading = true
        error = nil
        offset = 0
        do {
            let response = try await apiClient.listHistory(
                assigneeId: assigneeId,
                search: search,
                limit: pageSize,
                offset: 0
            )
            items = response.data
            hasMore = response.pagination.hasMore
            offset = pageSize
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    func loadMore(assigneeId: String? = nil, search: String? = nil, apiClient: APIClient) async {
        guard !isLoadingMore, hasMore else { return }
        isLoadingMore = true
        do {
            let response = try await apiClient.listHistory(
                assigneeId: assigneeId,
                search: search,
                limit: pageSize,
                offset: offset
            )
            items.append(contentsOf: response.data)
            hasMore = response.pagination.hasMore
            offset += pageSize
        } catch {
            self.error = error.localizedDescription
        }
        isLoadingMore = false
    }

    func formatDate(_ dateString: String?) -> String {
        guard let dateString else { return "" }
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        formatter.timeZone = TimeZone(identifier: "UTC")
        guard let date = formatter.date(from: dateString) else { return dateString }

        let displayFormatter = DateFormatter()
        displayFormatter.dateStyle = .medium
        displayFormatter.timeStyle = .short
        return displayFormatter.string(from: date)
    }

    func formatDuration(_ seconds: Int?) -> String? {
        guard let seconds, seconds > 0 else { return nil }
        if seconds < 60 { return "\(seconds)s" }
        let minutes = seconds / 60
        let remaining = seconds % 60
        if remaining == 0 { return "\(minutes)m" }
        return "\(minutes)m \(remaining)s"
    }
}
