import AssistantCore
import SwiftUI

@Observable
final class BriefingListViewModel {
    var sections: [BriefingSection] = []
    var isLoading = false
    var isLoadingMore = false
    var hasMore = true
    var error: String?

    private var offset = 0
    private let pageSize = 20

    var allBriefings: [Briefing] {
        sections.flatMap(\.briefings)
    }

    func loadBriefings(apiClient: APIClient) async {
        isLoading = true
        error = nil
        offset = 0
        do {
            let response = try await apiClient.listBriefings(limit: pageSize, offset: 0)
            sections = response.data
            hasMore = response.pagination.hasMore
            offset = pageSize
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    func loadMore(apiClient: APIClient) async {
        guard !isLoadingMore, hasMore else { return }
        isLoadingMore = true
        do {
            let response = try await apiClient.listBriefings(limit: pageSize, offset: offset)
            // Merge new sections into existing ones
            for newSection in response.data {
                if let idx = sections.firstIndex(where: { $0.date == newSection.date }) {
                    // Same date — append briefings
                    let merged = BriefingSection(
                        date: newSection.date,
                        briefings: sections[idx].briefings + newSection.briefings
                    )
                    sections[idx] = merged
                } else {
                    sections.append(newSection)
                }
            }
            hasMore = response.pagination.hasMore
            offset += pageSize
        } catch {
            self.error = error.localizedDescription
        }
        isLoadingMore = false
    }

    func deleteBriefing(id: String, apiClient: APIClient, eventManager: EventManager) async {
        do {
            try await apiClient.deleteBriefing(id: id)
            // Remove from sections
            for i in sections.indices {
                sections[i] = BriefingSection(
                    date: sections[i].date,
                    briefings: sections[i].briefings.filter { $0.id != id }
                )
            }
            sections.removeAll { $0.briefings.isEmpty }
            eventManager.emit(.briefingDeleted(id))
        } catch {
            self.error = error.localizedDescription
        }
    }

    func subscribeToEvents(eventManager: EventManager, apiClient: APIClient) async {
        for await event in eventManager.stream {
            switch event {
                case .briefingCreated, .briefingDeleted:
                    await loadBriefings(apiClient: apiClient)
                default:
                    break
            }
        }
    }

    /// Format a YYYY-MM-DD date string to a display label (Today, Yesterday, or formatted)
    func displayDate(for dateString: String) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone(identifier: "UTC")
        guard let date = formatter.date(from: dateString) else { return dateString }

        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return "Today" }
        if calendar.isDateInYesterday(date) { return "Yesterday" }

        let displayFormatter = DateFormatter()
        displayFormatter.dateStyle = .medium
        return displayFormatter.string(from: date)
    }
}
