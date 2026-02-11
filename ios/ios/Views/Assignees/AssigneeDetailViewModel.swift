import AssistantCore
import SwiftUI

@Observable
final class AssigneeDetailViewModel {
    var assignee: Assignee?
    var isLoading = true
    var error: String?

    func loadAssignee(id: String, apiClient: APIClient) async {
        isLoading = true
        error = nil
        do {
            assignee = try await apiClient.getAssignee(id: id)
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    func deleteAssignee(apiClient: APIClient, eventManager: EventManager) async {
        guard let assignee else { return }
        do {
            try await apiClient.deleteAssignee(id: assignee.id)
            eventManager.emit(.assigneeDeleted(assignee.id))
        } catch {
            self.error = error.localizedDescription
        }
    }
}
