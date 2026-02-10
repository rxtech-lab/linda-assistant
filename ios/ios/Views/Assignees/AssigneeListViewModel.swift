import SwiftUI
import AssistantCore

@Observable
final class AssigneeListViewModel {
    var assignees: [Assignee] = []
    var isLoading = false
    var error: String?

    func loadAssignees(apiClient: APIClient) async {
        isLoading = true
        error = nil
        do {
            let response = try await apiClient.listAssignees()
            assignees = response.data
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    func deleteAssignees(at offsets: IndexSet, apiClient: APIClient, eventManager: EventManager) async {
        for index in offsets {
            let assignee = assignees[index]
            do {
                try await apiClient.deleteAssignee(id: assignee.id)
                assignees.remove(at: index)
                eventManager.emit(.assigneeDeleted(assignee.id))
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    func subscribeToEvents(eventManager: EventManager, apiClient: APIClient) async {
        for await event in eventManager.stream {
            switch event {
            case .assigneeCreated, .assigneeUpdated, .assigneeDeleted:
                await loadAssignees(apiClient: apiClient)
            default:
                break
            }
        }
    }
}
