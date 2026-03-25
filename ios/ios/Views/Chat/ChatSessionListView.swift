import AssistantCore
import SwiftUI

struct ChatSessionListView: View {
    let taskId: String
    @Environment(AuthManager.self) private var authManager
    @Environment(EventManager.self) private var eventManager
    @State private var viewModel = ChatSessionListViewModel()
    @State private var showingNewChat = false
    @State private var searchText = ""

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
                                    if let createdAt = session.createdAt {
                                        Text(formatDateTime(createdAt))
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
                        .onAppear {
                            if session.id == viewModel.sessions.last?.id {
                                Task {
                                    await viewModel.loadMore(
                                        taskId: taskId,
                                        apiClient: apiClient,
                                        search: searchText
                                    )
                                }
                            }
                        }
                    }
                    .onDelete { offsets in
                        Task {
                            await viewModel.deleteSessions(
                                at: offsets,
                                apiClient: apiClient,
                                eventManager: eventManager
                            )
                        }
                    }

                    if viewModel.isLoadingMore {
                        HStack {
                            Spacer()
                            ProgressView()
                            Spacer()
                        }
                    }
                }
                .refreshable {
                    await viewModel.loadSessions(
                        taskId: taskId,
                        apiClient: apiClient,
                        search: searchText
                    )
                }
            }
        }
        .searchable(text: $searchText, prompt: "Search sessions")
        .onChange(of: searchText) {
            Task {
                await viewModel.loadSessions(
                    taskId: taskId,
                    apiClient: apiClient,
                    search: searchText
                )
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
                case let .taskChatSessions(taskId): ChatSessionListView(taskId: taskId)
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

    private func formatDateTime(_ dateString: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: dateString) else {
            formatter.formatOptions = [.withInternetDateTime]
            guard let date = formatter.date(from: dateString) else { return dateString }
            return formatDate(date)
        }
        return formatDate(date)
    }

    private func formatDate(_ date: Date) -> String {
        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return df.string(from: date)
    }
}
