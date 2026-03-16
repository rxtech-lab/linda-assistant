import AssistantCore
import SwiftUI

struct AssigneeListView: View {
    @Environment(AuthManager.self) private var authManager
    @Environment(EventManager.self) private var eventManager
    @State private var viewModel = AssigneeListViewModel()
    @State private var showingNewAssignee = false

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    var body: some View {
        Group {
            if viewModel.isLoading, viewModel.assignees.isEmpty {
                ProgressView()
            } else if let error = viewModel.error, viewModel.assignees.isEmpty {
                ErrorRetryView(message: error) {
                    Task { await viewModel.loadAssignees(apiClient: apiClient) }
                }
            } else if viewModel.assignees.isEmpty {
                EmptyStateView(
                    icon: "person.2",
                    title: "No Assistants",
                    message: "Create an AI assistant to get started."
                )
            } else {
                List {
                    ForEach(viewModel.assignees) { assignee in
                        NavigationLink(value: AppDestination.assignee(id: assignee.id, name: assignee.name)) {
                            AssigneeRowView(assignee: assignee)
                        }
                    }
                    .onDelete { offsets in
                        Task { await viewModel.deleteAssignees(
                            at: offsets,
                            apiClient: apiClient,
                            eventManager: eventManager
                        ) }
                    }
                }
                .refreshable {
                    await viewModel.loadAssignees(apiClient: apiClient)
                }
            }
        }
        .navigationTitle("Assistants")
        .navigationDestination(for: AppDestination.self) { destination in
            switch destination {
                case let .task(id): TaskDetailView(taskId: id)
                case let .chatSession(id): ChatDetailView(sessionId: id)
                case let .email(id): EmailDetailView(emailId: id)
                case let .assignee(id, name): AssigneeDetailView(assigneeId: id, assigneeName: name)

            }
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showingNewAssignee = true
                } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .sheet(isPresented: $showingNewAssignee) {
            AssigneeFormSheet(mode: .create) { assignee in
                viewModel.assignees.insert(assignee, at: 0)
                eventManager.emit(.assigneeCreated(assignee))
            }
        }
        .task {
            await viewModel.loadAssignees(apiClient: apiClient)
        }
        .task {
            await viewModel.subscribeToEvents(eventManager: eventManager, apiClient: apiClient)
        }
    }
}
