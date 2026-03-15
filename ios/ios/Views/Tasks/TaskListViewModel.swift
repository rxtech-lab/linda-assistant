import AssistantCore
import SwiftUI

@Observable
final class TaskListViewModel {
    var tasks: [LindaTask] = []
    var isLoading = false
    var error: String?

    func loadTasks(apiClient: APIClient) async {
        isLoading = true
        error = nil
        do {
            let response = try await apiClient.listTasks()
            tasks = response.data
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    func deleteTasks(at offsets: IndexSet, apiClient: APIClient, eventManager: EventManager) async {
        for index in offsets {
            let task = tasks[index]
            do {
                try await apiClient.deleteTask(id: task.id)
                tasks.remove(at: index)
                eventManager.emit(.taskDeleted(task.id))
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    func subscribeToEvents(eventManager: EventManager, apiClient: APIClient) async {
        for await event in eventManager.stream {
            switch event {
                case .taskCreated, .taskUpdated, .taskDeleted:
                    await loadTasks(apiClient: apiClient)
                default:
                    break
            }
        }
    }

    func startTask(id: String, apiClient: APIClient, eventManager: EventManager) async {
        do {
            let updated = try await apiClient.startTask(id: id)
            eventManager.emit(.taskUpdated(updated))
        } catch {
            self.error = error.localizedDescription
        }
    }

    func stopTask(id: String, apiClient: APIClient, eventManager: EventManager) async {
        do {
            let updated = try await apiClient.stopTask(id: id)
            eventManager.emit(.taskUpdated(updated))
        } catch {
            self.error = error.localizedDescription
        }
    }

    func executeTaskNow(id: String, apiClient: APIClient, eventManager: EventManager) async {
        do {
            _ = try await apiClient.executeTaskNow(id: id)
            await loadTasks(apiClient: apiClient)
        } catch {
            self.error = error.localizedDescription
        }
    }
}
