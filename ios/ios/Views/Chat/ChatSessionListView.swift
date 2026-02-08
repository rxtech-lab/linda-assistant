import SwiftUI
import AssistantCore

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
            if viewModel.isLoading && viewModel.sessions.isEmpty {
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
                        Task { await viewModel.deleteSessions(at: offsets, apiClient: apiClient, eventManager: eventManager) }
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
            case .task(let id): TaskDetailView(taskId: id)
            case .chatSession(let id): ChatDetailView(sessionId: id)
            case .email(let id): EmailDetailView(emailId: id)
            case .assignee(let id, let name): AssigneeDetailView(assigneeId: id, assigneeName: name)
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
