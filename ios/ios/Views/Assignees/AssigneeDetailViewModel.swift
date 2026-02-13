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

    func updateToolPermission(
        toolName: String,
        newPermission: String,
        apiClient: APIClient,
        eventManager: EventManager
    ) async {
        guard let assignee else { return }

        // Build updated permissions array
        var updatedPermissions = assignee.toolPermissions ?? []
        if let index = updatedPermissions.firstIndex(where: { $0.toolName == toolName }) {
            updatedPermissions[index] = ToolPermission(toolName: toolName, permission: newPermission)
        } else {
            updatedPermissions.append(ToolPermission(toolName: toolName, permission: newPermission))
        }

        do {
            let updated = try await apiClient.updateAssignee(
                id: assignee.id,
                UpdateAssignee(toolPermissions: updatedPermissions)
            )
            self.assignee = updated
            eventManager.emit(.assigneeUpdated(updated))
        } catch {
            self.error = error.localizedDescription
        }
    }
}
