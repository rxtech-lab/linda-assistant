import AssistantCore
import SwiftUI

@Observable
final class TaskDetailViewModel {
    var task: TaskDetail?
    var isLoading = true
    var loadingError: String?
    var actionError: String?

    func loadTask(id: String, apiClient: APIClient) async {
        isLoading = true
        loadingError = nil
        do {
            task = try await apiClient.getTask(id: id)
        } catch {
            self.loadingError = error.localizedDescription
        }
        isLoading = false
    }

    func refreshTask(id: String, apiClient: APIClient) async {
        do {
            task = try await apiClient.getTask(id: id)
        } catch {
            if task == nil {
                self.loadingError = error.localizedDescription
            }
        }
    }

    func deleteTask(apiClient: APIClient, eventManager: EventManager) async {
        guard let task else { return }
        do {
            try await apiClient.deleteTask(id: task.id)
            eventManager.emit(.taskDeleted(task.id))
        } catch {
            self.actionError = error.localizedDescription
        }
    }

    func subscribeToEvents(taskId: String, eventManager: EventManager, apiClient: APIClient) async {
        for await event in eventManager.stream {
            switch event {
                case let .chatSessionCreated(session) where session.taskId == taskId:
                    await loadTask(id: taskId, apiClient: apiClient)
                case .chatSessionDeleted:
                    await loadTask(id: taskId, apiClient: apiClient)
                case let .taskUpdated(updated) where updated.id == taskId:
                    await loadTask(id: taskId, apiClient: apiClient)
                case let .taskExtensionUpdated(tId, _) where tId == taskId:
                    await loadTask(id: taskId, apiClient: apiClient)
                default:
                    break
            }
        }
    }

    func updateToolPermission(
        toolName: String,
        newPermission: String,
        apiClient: APIClient,
        eventManager: EventManager
    ) async {
        guard let task else { return }
        var permissions = task.toolPermissions ?? []
        if let index = permissions.firstIndex(where: { $0.toolName == toolName }) {
            permissions[index] = ToolPermission(toolName: toolName, permission: newPermission)
        } else {
            permissions.append(ToolPermission(toolName: toolName, permission: newPermission))
        }
        do {
            let updated = try await apiClient.updateTask(
                id: task.id,
                UpdateTask(toolPermissions: permissions)
            )
            eventManager.emit(.taskUpdated(updated))
        } catch {
            self.actionError = error.localizedDescription
        }
    }

    func startTask(apiClient: APIClient, eventManager: EventManager) async {
        guard let task else { return }
        do {
            let updated = try await apiClient.startTask(id: task.id)
            eventManager.emit(.taskUpdated(updated))
        } catch {
            self.actionError = error.localizedDescription
        }
    }

    func stopTask(apiClient: APIClient, eventManager: EventManager) async {
        guard let task else { return }
        do {
            let updated = try await apiClient.stopTask(id: task.id)
            eventManager.emit(.taskUpdated(updated))
        } catch {
            self.actionError = error.localizedDescription
        }
    }

    func executeNow(apiClient: APIClient, eventManager: EventManager) async {
        guard let task else { return }
        do {
            _ = try await apiClient.executeTaskNow(id: task.id)
            await loadTask(id: task.id, apiClient: apiClient)
        } catch {
            self.actionError = error.localizedDescription
        }
    }

    func deleteChatSessions(at offsets: IndexSet, apiClient: APIClient, eventManager: EventManager) async {
        guard let task else { return }
        let sessions = task.chatSessions
        for index in offsets.sorted(by: >) {
            let session = sessions[index]
            do {
                try await apiClient.deleteChatSession(id: session.id)
                eventManager.emit(.chatSessionDeleted(session.id))
            } catch {
                self.actionError = error.localizedDescription
            }
        }
        await loadTask(id: task.id, apiClient: apiClient)
    }
}
