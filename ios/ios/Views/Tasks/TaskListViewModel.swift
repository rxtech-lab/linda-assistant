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

    func deleteTask(id: String, apiClient: APIClient, eventManager: EventManager) async {
        do {
            try await apiClient.deleteTask(id: id)
            tasks.removeAll { $0.id == id }
            eventManager.emit(.taskDeleted(id))
        } catch {
            self.error = error.localizedDescription
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
