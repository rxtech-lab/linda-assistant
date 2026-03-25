import AssistantCore
import SwiftUI

struct TaskListView: View {
    @Environment(AuthManager.self) private var authManager
    @Environment(EventManager.self) private var eventManager
    @State private var viewModel = TaskListViewModel()
    @State private var showingNewTask = false

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    var body: some View {
        Group {
            if viewModel.isLoading, viewModel.tasks.isEmpty {
                ProgressView()
            } else if let error = viewModel.error, viewModel.tasks.isEmpty {
                ErrorRetryView(message: error) {
                    Task { await viewModel.loadTasks(apiClient: apiClient) }
                }
            } else if viewModel.tasks.isEmpty {
                EmptyStateView(
                    icon: "checklist",
                    title: "No Tasks",
                    message: "Create your first task to get started."
                )
            } else {
                List {
                    ForEach(viewModel.tasks) { task in
                        NavigationLink(value: AppDestination.task(id: task.id)) {
                            TaskRowView(
                                task: task,
                                onDelete: {
                                    Task {
                                        await viewModel.deleteTask(
                                            id: task.id,
                                            apiClient: apiClient,
                                            eventManager: eventManager
                                        )
                                    }
                                },
                                onRunNow: {
                                    Task {
                                        await viewModel.executeTaskNow(
                                            id: task.id,
                                            apiClient: apiClient,
                                            eventManager: eventManager
                                        )
                                    }
                                }
                            )
                        }
                    }
                }
                .refreshable {
                    await viewModel.loadTasks(apiClient: apiClient)
                }
            }
        }
        .navigationTitle("Tasks")
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
                    showingNewTask = true
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityIdentifier("add-task-button")
            }
        }
        .sheet(isPresented: $showingNewTask) {
            TaskFormSheet(mode: .create) { task in
                viewModel.tasks.insert(task, at: 0)
                eventManager.emit(.taskCreated(task))
            }
        }
        .task {
            await viewModel.loadTasks(apiClient: apiClient)
        }
        .task {
            await viewModel.subscribeToEvents(eventManager: eventManager, apiClient: apiClient)
        }
    }
}
