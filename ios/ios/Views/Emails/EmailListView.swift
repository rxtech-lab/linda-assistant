import SwiftUI
import AssistantCore

struct EmailListView: View {
    @Environment(AuthManager.self) private var authManager
    @Environment(EventManager.self) private var eventManager
    @State private var viewModel = EmailListViewModel()

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    var body: some View {
        Group {
            if viewModel.isLoading && viewModel.emails.isEmpty {
                ProgressView()
            } else if let error = viewModel.error, viewModel.emails.isEmpty {
                ErrorRetryView(message: error) {
                    Task { await viewModel.loadEmails(apiClient: apiClient) }
                }
            } else if viewModel.emails.isEmpty {
                EmptyStateView(
                    icon: "envelope",
                    title: "No Emails",
                    message: "Incoming emails will appear here."
                )
            } else {
                List {
                    ForEach(viewModel.emails) { email in
                        NavigationLink(value: email.id) {
                            EmailRowView(email: email)
                        }
                    }
                    .onDelete { offsets in
                        Task { await viewModel.deleteEmails(at: offsets, apiClient: apiClient, eventManager: eventManager) }
                    }
                }
                .refreshable {
                    await viewModel.loadEmails(apiClient: apiClient)
                }
            }
        }
        .navigationTitle("Email Inbox")
        .navigationDestination(for: String.self) { emailId in
            EmailDetailView(emailId: emailId)
        }
        .task {
            await viewModel.loadEmails(apiClient: apiClient)
        }
        .task {
            await viewModel.subscribeToEvents(eventManager: eventManager, apiClient: apiClient)
        }
    }
}
