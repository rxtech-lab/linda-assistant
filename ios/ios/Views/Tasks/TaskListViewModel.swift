import AssistantCore
import SwiftUI

@Observable
final class TaskListViewModel {
    var tasks: [LindaTask] = []
    var isLoading = false
    var isSwitchingSource = false
    var error: String?
    var selectedSource: TaskSourceFilter?

    func loadTasks(apiClient: APIClient, animated: Bool = false) async {
        isLoading = true
        error = nil
        do {
            let response = try await apiClient.listTasks(source: selectedSource?.rawValue)
            if animated {
                withAnimation(.default) {
                    tasks = response.data
                }
            } else {
                tasks = response.data
            }
        } catch let decodingError as DecodingError {
            let detail = Self.describeDecodingError(decodingError)
            print("[TaskList] Decoding error: \(detail)")
            self.error = detail
        } catch {
            print("[TaskList] Load error: \(error)")
            self.error = error.localizedDescription
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

    func selectSource(_ source: TaskSourceFilter?, apiClient: APIClient) async {
        withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) {
            selectedSource = source
            isSwitchingSource = true
        }
        await loadTasks(apiClient: apiClient, animated: true)
        withAnimation {
            isSwitchingSource = false
        }
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
