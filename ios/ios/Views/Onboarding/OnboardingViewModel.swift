import AssistantCore
import SwiftUI

@Observable
final class OnboardingViewModel {
    var name = "Linda"
    var email = ""
    var personality = "You are a helpful personal assistant."
    var selectedModel = ""
    var availableModels: [String] = []
    var availableTools: [AgentTool] = []
    var toolPermissions: [String: String] = [:]
    var toolConditions: [String: [ToolCondition]] = [:]
    var toolConditionLogics: [String: String] = [:]
    var isLoadingModelsAndTools = false
    var isSubmitting = false
    var isComplete = false
    var error: String?

    var isValid: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty &&
            !email.trimmingCharacters(in: .whitespaces).isEmpty &&
            email.contains("@")
    }

    func loadModelsAndTools(apiClient: APIClient) async {
        isLoadingModelsAndTools = true
        do {
            async let modelsReq = apiClient.listModels()
            async let toolsReq = apiClient.listTools()
            let (models, tools) = try await (modelsReq, toolsReq)
            availableModels = models
            availableTools = tools
            if selectedModel.isEmpty, let first = models.first {
                selectedModel = first
            }
            for tool in tools {
                toolPermissions[tool.name] = tool.defaultPermission
            }
        } catch {
            self.error = error.localizedDescription
        }
        isLoadingModelsAndTools = false
    }

    func createAssignee(apiClient: APIClient, eventManager: EventManager) async {
        isSubmitting = true
        error = nil

        let permissions = toolPermissions
            .filter { entry in
                // Exclude tools that cannot have their permission changed
                !(availableTools.first(where: { $0.name == entry.key })?.disablePermissionChange == true)
            }
            .map { entry in
                let conditions: [ToolCondition]? = entry.value == "auto-confirm"
                    ? (toolConditions[entry.key]?.isEmpty == false ? toolConditions[entry.key] : nil)
                    : nil
                let logic: String? = conditions != nil ? toolConditionLogics[entry.key] : nil
                return ToolPermission(toolName: entry.key, permission: entry.value, conditions: conditions, conditionLogic: logic)
            }

        let body = CreateAssignee(
            name: name.trimmingCharacters(in: .whitespaces),
            email: email.trimmingCharacters(in: .whitespaces),
            personality: personality.isEmpty ? nil : personality,
            model: selectedModel.isEmpty ? nil : selectedModel,
            toolPermissions: permissions.isEmpty ? nil : permissions
        )

        do {
            let assignee = try await apiClient.createAssignee(body)
            eventManager.emit(.assigneeCreated(assignee))
            isComplete = true
        } catch {
            self.error = error.localizedDescription
        }

        isSubmitting = false
    }
}
