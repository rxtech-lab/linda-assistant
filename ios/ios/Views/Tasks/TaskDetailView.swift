import AssistantCore
import SwiftUI

struct TaskDetailView: View {
    let taskId: String
    @Environment(AuthManager.self) private var authManager
    @Environment(EventManager.self) private var eventManager
    @State private var viewModel = TaskDetailViewModel()
    @State private var showingEdit = false
    @State private var showingDelete = false
    @State private var showingNewChat = false

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    var body: some View {
        Group {
            if viewModel.isLoading {
                ProgressView()
            } else if let error = viewModel.error {
                ErrorRetryView(message: error) {
                    Task { await viewModel.loadTask(id: taskId, apiClient: apiClient) }
                }
            } else if let task = viewModel.task {
                List {
                    Section("Status") {
                        if let status = task.status {
                            StatusBadge(status: status)
                        }
                    }

                    if let description = task.description, !description.isEmpty {
                        Section("Description") {
                            Text(description)
                        }
                    }

                    if let tags = task.tags, !tags.isEmpty {
                        Section("Tags") {
                            FlowLayout(tags: tags)
                        }
                    }

                    if let categories = task.categories, !categories.isEmpty {
                        Section("Categories") {
                            FlowLayout(tags: categories)
                        }
                    }

                    Section("Chat Sessions") {
                        if task.chatSessions.isEmpty {
                            Text("No chat sessions yet")
                                .foregroundStyle(.secondary)
                        } else {
                            ForEach(task.chatSessions) { session in
                                NavigationLink(value: AppDestination.chatSession(id: session.id)) {
                                    HStack {
                                        Text(session.title ?? "Untitled")
                                        Spacer()
                                        if let status = session.status {
                                            StatusBadge(status: status)
                                        }
                                    }
                                }
                            }
                            .onDelete { offsets in
                                Task {
                                    await viewModel.deleteChatSessions(at: offsets, apiClient: apiClient, eventManager: eventManager)
                                }
                            }
                        }

                        Button {
                            showingNewChat = true
                        } label: {
                            Label("Start New Chat Session", systemImage: "plus.bubble")
                        }
                    }

                    if !task.emails.isEmpty {
                        Section("Related Emails") {
                            ForEach(task.emails) { email in
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(email.subject ?? "No Subject")
                                        .font(.body)
                                    Text("from: \(email.fromEmail)")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle(viewModel.task?.title ?? "Task")
        .navigationDestination(for: AppDestination.self) { destination in
            switch destination {
            case .task(let id): TaskDetailView(taskId: id)
            case .chatSession(let id): ChatDetailView(sessionId: id)
            case .email(let id): EmailDetailView(emailId: id)
            case .assignee(let id, let name): AssigneeDetailView(assigneeId: id, assigneeName: name)
            }
        }
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button("Edit", systemImage: "pencil") { showingEdit = true }
                    Button("Delete", systemImage: "trash", role: .destructive) { showingDelete = true }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .sheet(isPresented: $showingEdit) {
            if let task = viewModel.task {
                TaskFormSheet(mode: .edit(task)) { updatedTask in
                    eventManager.emit(.taskUpdated(updatedTask))
                }
            }
        }
        .sheet(isPresented: $showingDelete) {
            DeleteConfirmationSheet(
                title: "Delete Task?",
                message: "\"\(viewModel.task?.title ?? "")\" will be permanently deleted."
            ) {
                Task {
                    await viewModel.deleteTask(apiClient: apiClient, eventManager: eventManager)
                }
            }
        }
        .sheet(isPresented: $showingNewChat) {
            NewChatSheet(taskId: taskId)
        }
        .task {
            await viewModel.loadTask(id: taskId, apiClient: apiClient)
            await viewModel.subscribeToEvents(taskId: taskId, eventManager: eventManager, apiClient: apiClient)
        }
    }
}

private struct FlowLayout: View {
    let tags: [String]

    var body: some View {
        HStack(spacing: 6) {
            ForEach(tags, id: \.self) { tag in
                Text(tag)
                    .font(.caption)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(.fill.tertiary)
                    .clipShape(Capsule())
            }
        }
    }
}
