import SwiftUI
import AssistantCore

@Observable
final class TaskDetailViewModel {
    var task: TaskDetail?
    var isLoading = false
    var error: String?

    func loadTask(id: String, apiClient: APIClient) async {
        isLoading = true
        error = nil
        do {
            task = try await apiClient.getTask(id: id)
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    func deleteTask(apiClient: APIClient, eventManager: EventManager) async {
        guard let task else { return }
        do {
            try await apiClient.deleteTask(id: task.id)
            eventManager.emit(.taskDeleted(task.id))
        } catch {
            self.error = error.localizedDescription
        }
    }

    func subscribeToEvents(taskId: String, eventManager: EventManager, apiClient: APIClient) async {
        for await event in eventManager.stream {
            switch event {
            case .chatSessionCreated(let session) where session.taskId == taskId:
                await loadTask(id: taskId, apiClient: apiClient)
            case .chatSessionDeleted:
                await loadTask(id: taskId, apiClient: apiClient)
            case .taskUpdated(let updated) where updated.id == taskId:
                await loadTask(id: taskId, apiClient: apiClient)
            default:
                break
            }
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
                self.error = error.localizedDescription
            }
        }
        await loadTask(id: task.id, apiClient: apiClient)
    }
}
