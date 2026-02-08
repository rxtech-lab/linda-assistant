import SwiftUI
import AssistantCore

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
            if viewModel.isLoading && viewModel.tasks.isEmpty {
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
                        NavigationLink(value: task.id) {
                            TaskRowView(task: task)
                        }
                    }
                    .onDelete { offsets in
                        Task { await viewModel.deleteTasks(at: offsets, apiClient: apiClient, eventManager: eventManager) }
                    }
                }
                .refreshable {
                    await viewModel.loadTasks(apiClient: apiClient)
                }
            }
        }
        .navigationTitle("Tasks")
        .navigationDestination(for: String.self) { taskId in
            TaskDetailView(taskId: taskId)
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showingNewTask = true
                } label: {
                    Image(systemName: "plus")
                }
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
