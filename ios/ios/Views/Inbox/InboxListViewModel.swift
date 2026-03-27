import AssistantCore
import SwiftUI

enum InboxItem: Identifiable {
    case email(Email)
    case webhook(Webhook)

    var id: String {
        switch self {
            case let .email(e): "email-\(e.id)"
            case let .webhook(w): "webhook-\(w.id)"
        }
    }

    var receivedAt: String {
        switch self {
            case let .email(e): e.receivedAt
            case let .webhook(w): w.receivedAt
        }
    }
}

@Observable
final class InboxListViewModel {
    var emails: [Email] = []
    var webhooks: [Webhook] = []
    var selectedCategory: InboxCategory?
    var isLoading = false
    var isSwitchingCategory = false
    var error: String?

    var items: [InboxItem] {
        switch selectedCategory {
            case .email:
                return emails.map { .email($0) }
            case .webhook:
                return webhooks.map { .webhook($0) }
            case nil:
                let emailItems = emails.map { InboxItem.email($0) }
                let webhookItems = webhooks.map { InboxItem.webhook($0) }
                return (emailItems + webhookItems).sorted { $0.receivedAt > $1.receivedAt }
        }
    }

    func selectCategory(_ category: InboxCategory?, apiClient: APIClient) async {
        guard selectedCategory != category else { return }
        withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) {
            selectedCategory = category
            isSwitchingCategory = true
        }
        await loadItems(apiClient: apiClient)
        withAnimation {
            isSwitchingCategory = false
        }
    }

    func loadItems(apiClient: APIClient) async {
        isLoading = true
        error = nil
        do {
            switch selectedCategory {
                case .email:
                    let response = try await apiClient.listEmails()
                    emails = response.data
                case .webhook:
                    let response = try await apiClient.listWebhooks()
                    webhooks = response.data
                case nil:
                    async let emailsResponse = apiClient.listEmails()
                    async let webhooksResponse = apiClient.listWebhooks()
                    emails = try await emailsResponse.data
                    webhooks = try await webhooksResponse.data
            }
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    func deleteEmail(
        at offsets: IndexSet,
        from displayedEmails: [Email],
        apiClient: APIClient,
        eventManager: EventManager
    ) async {
        for index in offsets {
            let email = displayedEmails[index]
            do {
                try await apiClient.deleteEmail(id: email.id)
                emails.removeAll { $0.id == email.id }
                eventManager.emit(.emailDeleted(email.id))
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    func deleteWebhook(
        at offsets: IndexSet,
        from displayedWebhooks: [Webhook],
        apiClient: APIClient,
        eventManager: EventManager
    ) async {
        for index in offsets {
            let webhook = displayedWebhooks[index]
            do {
                try await apiClient.deleteWebhook(id: webhook.id)
                webhooks.removeAll { $0.id == webhook.id }
                eventManager.emit(.webhookDeleted(webhook.id))
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    func subscribeToEvents(eventManager: EventManager, apiClient: APIClient) async {
        for await event in eventManager.stream {
            switch event {
                case .emailUpdated, .emailDeleted:
                    if selectedCategory != .webhook {
                        await loadItems(apiClient: apiClient)
                    }
                case .webhookUpdated, .webhookDeleted:
                    if selectedCategory != .email {
                        await loadItems(apiClient: apiClient)
                    }
                default:
                    break
            }
        }
    }
}
