import AssistantCore
import SwiftUI

struct ChatSessionListView: View {
    let taskId: String
    @Environment(AuthManager.self) private var authManager
    @Environment(EventManager.self) private var eventManager
    @State private var viewModel = ChatSessionListViewModel()
    @State private var showingNewChat = false

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    var body: some View {
        Group {
            if viewModel.isLoading, viewModel.sessions.isEmpty {
                ProgressView()
            } else if viewModel.sessions.isEmpty {
                EmptyStateView(
                    icon: "bubble.left.and.bubble.right",
                    title: "No Chat Sessions",
                    message: "Start a conversation with your assistant."
                )
            } else {
                List {
                    ForEach(viewModel.sessions) { session in
                        NavigationLink(value: AppDestination.chatSession(id: session.id)) {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(session.title ?? "Untitled")
                                        .font(.body)
                                    if let updatedAt = session.updatedAt {
                                        Text(updatedAt)
                                            .font(.caption)
                                            .foregroundStyle(.tertiary)
                                    }
                                }
                                Spacer()
                                if let status = session.status {
                                    StatusBadge(status: status)
                                }
                            }
                        }
                    }
                    .onDelete { offsets in
                        Task { await viewModel.deleteSessions(
                            at: offsets,
                            apiClient: apiClient,
                            eventManager: eventManager
                        ) }
                    }
                }
                .refreshable {
                    await viewModel.loadSessions(taskId: taskId, apiClient: apiClient)
                }
            }
        }
        .navigationTitle("Chat Sessions")
        .navigationDestination(for: AppDestination.self) { destination in
            switch destination {
                case let .task(id): TaskDetailView(taskId: id)
                case let .chatSession(id): ChatDetailView(sessionId: id)
                case let .email(id): EmailDetailView(emailId: id)
                case let .assignee(id, name): AssigneeDetailView(assigneeId: id, assigneeName: name)
                case let .assigneeExtensions(assigneeId): AssigneeExtensionListView(assigneeId: assigneeId)
                case let .taskToolPermissions(taskId): TaskToolPermissionsView(taskId: taskId)
                case let .taskExtensions(taskId): TaskExtensionListView(taskId: taskId)
                case let .extensionDetail(extensionId, assigneeId, taskId):
                    ExtensionDetailView(extensionId: extensionId, assigneeId: assigneeId, taskId: taskId)
                case .extensionList: ExtensionListView()
                case .assigneeList: AssigneeListView()
                case .usage: UsageView()
            }
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showingNewChat = true
                } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .sheet(isPresented: $showingNewChat) {
            NewChatSheet(taskId: taskId)
        }
        .task {
            await viewModel.loadSessions(taskId: taskId, apiClient: apiClient)
        }
    }
}
