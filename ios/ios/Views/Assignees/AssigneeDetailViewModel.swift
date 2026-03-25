import AssistantCore
import SwiftUI

@Observable
final class AssigneeDetailViewModel {
    var assignee: Assignee?
    var tools: [AgentTool] = []
    var isLoading = true
    var isRefreshing = false
    var error: String?

    /// Map tool name to AgentTool for parameter metadata lookup
    func tool(for name: String) -> AgentTool? {
        tools.first(where: { $0.name == name })
    }

    func loadAssignee(id: String, apiClient: APIClient) async {
        isLoading = true
        error = nil
        do {
            async let assigneeReq = apiClient.getAssignee(id: id)
            async let schemaReq = apiClient.getAssigneeFormSchema(id: id)
            let (assignee, schema) = try await (assigneeReq, schemaReq)
            self.assignee = assignee
            tools = schema.tools
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

    func subscribeToEvents(eventManager: EventManager, apiClient: APIClient) async {
        for await event in eventManager.stream {
            switch event {
                case let .assigneeUpdated(updated) where updated.id == assignee?.id:
                    isRefreshing = true
                    do {
                        assignee = try await apiClient.getAssignee(id: updated.id)
                    } catch {
                        self.error = error.localizedDescription
                    }
                    isRefreshing = false
                default:
                    break
            }
        }
    }

    func updateToolPermission(
        toolName: String,
        newPermission: String,
        conditions: [ToolCondition]? = nil,
        conditionLogic: String? = nil,
        apiClient: APIClient,
        eventManager: EventManager
    ) async {
        guard let assignee else { return }

        // Skip tools that cannot have their permission changed
        if tools.first(where: { $0.name == toolName })?.disablePermissionChange == true {
            return
        }

        // Build updated permissions array, preserving existing conditions/logic unless explicitly provided
        var updatedPermissions = (assignee.toolPermissions ?? [])
            .filter { perm in
                // Exclude tools that cannot have their permission changed
                !(tools.first(where: { $0.name == perm.toolName })?.disablePermissionChange == true)
            }
        let existing = updatedPermissions.first(where: { $0.toolName == toolName })
        let newConditions = conditions ?? existing?.conditions
        let newLogic = conditionLogic ?? existing?.conditionLogic
        let isConditional = newPermission == "auto-confirm" && newConditions != nil && !(newConditions?.isEmpty ?? true)
        let newPerm = ToolPermission(
            toolName: toolName,
            permission: newPermission,
            conditions: newPermission == "auto-confirm" ? newConditions : nil,
            conditionLogic: isConditional ? newLogic : nil
        )

        if let index = updatedPermissions.firstIndex(where: { $0.toolName == toolName }) {
            updatedPermissions[index] = newPerm
        } else {
            updatedPermissions.append(newPerm)
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
