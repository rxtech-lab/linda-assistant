import AssistantCore
import SwiftUI

struct TaskToolPermissionsView: View {
    let taskId: String

    @Environment(AuthManager.self) private var authManager
    @Environment(EventManager.self) private var eventManager
    @State private var tools: [AgentTool] = []
    @State private var permissions: [String: String] = [:]
    @State private var conditions: [String: [ToolCondition]] = [:]
    @State private var conditionLogics: [String: String] = [:]
    @State private var isLoading = true
    @State private var error: String?

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
            } else if let error {
                ErrorRetryView(message: error) {
                    Task { await loadData() }
                }
            } else if tools.isEmpty {
                ContentUnavailableView(
                    "No Tools",
                    systemImage: "wrench.and.screwdriver",
                    description: Text("No system tools available.")
                )
            } else {
                List {
                    ForEach(tools) { tool in
                        ToolPermissionRow(
                            permission: ToolPermission(
                                toolName: tool.name,
                                permission: permissions[tool.name] ?? tool.defaultPermission,
                                conditions: conditions[tool.name],
                                conditionLogic: conditionLogics[tool.name]
                            ),
                            tool: tool
                        ) { newPermission in
                            if newPermission != "auto-confirm" {
                                conditions[tool.name] = nil
                                conditionLogics[tool.name] = nil
                            }
                            Task { await updatePermission(toolName: tool.name, permission: newPermission) }
                        } onConditionsChange: { newConditions in
                            conditions[tool.name] = newConditions.isEmpty ? nil : newConditions
                            Task { await updatePermission(
                                toolName: tool.name,
                                permission: permissions[tool.name] ?? tool.defaultPermission,
                                conditions: newConditions
                            ) }
                        } onConditionLogicChange: { newLogic in
                            conditionLogics[tool.name] = newLogic
                            Task { await updatePermission(
                                toolName: tool.name,
                                permission: permissions[tool.name] ?? tool.defaultPermission
                            ) }
                        }
                    }
                }
            }
        }
        .navigationTitle("Tool Permissions")
        .task {
            await loadData()
        }
        .task {
            for await event in eventManager.stream {
                if case let .taskUpdated(updated) = event, updated.id == taskId {
                    if let perms = updated.toolPermissions {
                        for perm in perms {
                            permissions[perm.toolName] = perm.permission
                            if let conds = perm.conditions, !conds.isEmpty {
                                conditions[perm.toolName] = conds
                            }
                            if let logic = perm.conditionLogic {
                                conditionLogics[perm.toolName] = logic
                            }
                        }
                    }
                }
            }
        }
    }

    private func loadData() async {
        isLoading = true
        error = nil
        do {
            async let schemaTask = apiClient.getAssigneeFormSchema()
            async let taskDetail = apiClient.getTask(id: taskId)
            let (schema, task) = try await (schemaTask, taskDetail)
            tools = schema.tools
            if let perms = task.toolPermissions {
                for perm in perms {
                    permissions[perm.toolName] = perm.permission
                    if let conds = perm.conditions, !conds.isEmpty {
                        conditions[perm.toolName] = conds
                    }
                    if let logic = perm.conditionLogic {
                        conditionLogics[perm.toolName] = logic
                    }
                }
            }
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    private func updatePermission(
        toolName: String,
        permission: String,
        conditions newConditions: [ToolCondition]? = nil
    ) async {
        // Skip tools that cannot have their permission changed
        if tools.first(where: { $0.name == toolName })?.disablePermissionChange == true {
            return
        }

        permissions[toolName] = permission
        if let newConditions {
            conditions[toolName] = newConditions.isEmpty ? nil : newConditions
        }
        let allPermissions = tools
            .filter { $0.disablePermissionChange != true }
            .map { tool in
                let perm = permissions[tool.name] ?? tool.defaultPermission
                let isConditional = perm == "auto-confirm" && conditions[tool.name] != nil
                return ToolPermission(
                    toolName: tool.name,
                    permission: perm,
                    conditions: perm == "auto-confirm" ? conditions[tool.name] : nil,
                    conditionLogic: isConditional ? conditionLogics[tool.name] : nil
                )
            }
        do {
            let updated = try await apiClient.updateTask(
                id: taskId,
                UpdateTask(toolPermissions: allPermissions)
            )
            eventManager.emit(.taskUpdated(updated))
        } catch {
            self.error = error.localizedDescription
        }
    }
}
