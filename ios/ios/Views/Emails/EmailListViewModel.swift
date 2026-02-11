import AssistantCore
import SwiftUI

@Observable
final class EmailListViewModel {
    var emails: [Email] = []
    var isLoading = false
    var error: String?

    func loadEmails(apiClient: APIClient) async {
        isLoading = true
        error = nil
        do {
            let response = try await apiClient.listEmails()
            emails = response.data
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    func deleteEmails(at offsets: IndexSet, apiClient: APIClient, eventManager: EventManager) async {
        for index in offsets {
            let email = emails[index]
            do {
                try await apiClient.deleteEmail(id: email.id)
                emails.remove(at: index)
                eventManager.emit(.emailDeleted(email.id))
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    func subscribeToEvents(eventManager: EventManager, apiClient: APIClient) async {
        for await event in eventManager.stream {
            switch event {
                case .emailUpdated, .emailDeleted:
                    await loadEmails(apiClient: apiClient)
                default:
                    break
            }
        }
    }
}
