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
        } catch let decodingError as DecodingError {
            let detail = Self.describeDecodingError(decodingError)
            print("[TaskDetail] Decoding error: \(detail)")
            self.loadingError = detail
        } catch {
            print("[TaskDetail] Load error: \(error)")
            self.loadingError = error.localizedDescription
        }
        isLoading = false
    }

    private static func describeDecodingError(_ error: DecodingError) -> String {
        switch error {
            case let .keyNotFound(key, context):
                let path = context.codingPath.map(\.stringValue).joined(separator: ".")
                return "Missing key '\(key.stringValue)' at path: \(path)"
            case let .typeMismatch(type, context):
                let path = context.codingPath.map(\.stringValue).joined(separator: ".")
                return "Type mismatch for \(type) at path: \(path) — \(context.debugDescription)"
            case let .valueNotFound(type, context):
                let path = context.codingPath.map(\.stringValue).joined(separator: ".")
                return "Value not found for \(type) at path: \(path)"
            case let .dataCorrupted(context):
                let path = context.codingPath.map(\.stringValue).joined(separator: ".")
                return "Data corrupted at path: \(path) — \(context.debugDescription)"
            @unknown default:
                return error.localizedDescription
        }
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
