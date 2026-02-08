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
}
