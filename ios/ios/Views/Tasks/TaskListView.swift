import AssistantCore
import SwiftUI
#if os(macOS)
import AppKit
#endif

struct TaskListView: View {
    @Environment(AuthManager.self) private var authManager
    @Environment(EventManager.self) private var eventManager
    @State private var viewModel = TaskListViewModel()
    @State private var showingNewTask = false
    @State private var taskToDelete: LindaTask?

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    private var chipBackgroundColor: Color {
        #if os(macOS)
        return Color(nsColor: .systemGray)
        #else
        return Color(.systemGray5)
        #endif
    }

    var body: some View {
        List {
            Section {
                if viewModel.isLoading, viewModel.tasks.isEmpty {
                    ProgressView()
                        .frame(maxWidth: .infinity, minHeight: 200)
                        .listRowSeparator(.hidden)
                } else if let error = viewModel.error, viewModel.tasks.isEmpty {
                    ErrorRetryView(message: error) {
                        Task { await viewModel.loadTasks(apiClient: apiClient) }
                    }
                    .listRowSeparator(.hidden)
                } else if viewModel.tasks.isEmpty {
                    EmptyStateView(
                        icon: "checklist",
                        title: "No Tasks",
                        message: viewModel.selectedSource != nil
                            ? "No \(viewModel.selectedSource!.displayName.lowercased()) tasks found."
                            : "Create your first task to get started."
                    )
                    .listRowSeparator(.hidden)
                } else {
                    ForEach(viewModel.tasks) { task in
                        NavigationLink(value: AppDestination.task(id: task.id)) {
                            TaskRowView(
                                task: task,
                                onDelete: {
                                    taskToDelete = task
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
                        .alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
                    }
                }
            } header: {
                sourceFilterBar()
                    .padding(.vertical, 4)
                    .textCase(nil)
            }
        }
        .listStyle(.plain)
        .overlay {
            if viewModel.isSwitchingSource, !viewModel.tasks.isEmpty {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(.ultraThinMaterial)
                    .transition(.opacity)
            }
        }
        .refreshable {
            await viewModel.loadTasks(apiClient: apiClient)
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
        .confirmationDialog(
            "Delete Task?",
            isPresented: Binding(
                get: { taskToDelete != nil },
                set: { if !$0 { taskToDelete = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let task = taskToDelete {
                    Task {
                        await viewModel.deleteTask(
                            id: task.id,
                            apiClient: apiClient,
                            eventManager: eventManager
                        )
                    }
                }
            }
        } message: {
            Text("\"\(taskToDelete?.title ?? "")\" will be permanently deleted.")
        }
        .task {
            await viewModel.loadTasks(apiClient: apiClient)
        }
        .task {
            await viewModel.subscribeToEvents(eventManager: eventManager, apiClient: apiClient)
        }
    }

    private func sourceFilterBar() -> some View {
        let allSources: [(String, String, TaskSource?)] = [
            ("All", "tray.full", nil),
        ] + TaskSource.allCases.map { ($0.displayName, $0.iconName, Optional($0)) }
        // Total parts: selected gets 2, others get 1 each → 2 + 3 = 5
        let totalParts: CGFloat = CGFloat(allSources.count) + 1 // +1 for the extra part on selected
        let spacing: CGFloat = 8

        return GeometryReader { geo in
            let totalSpacing = spacing * CGFloat(allSources.count - 1)
            let availableWidth = geo.size.width - totalSpacing
            let unitWidth = availableWidth / totalParts

            HStack(spacing: spacing) {
                ForEach(Array(allSources.enumerated()), id: \.offset) { _, item in
                    let isSelected = viewModel.selectedSource == item.2
                    let chipWidth = isSelected ? unitWidth * 2 : unitWidth

                    Button {
                        Task { await viewModel.selectSource(item.2, apiClient: apiClient) }
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: item.1)
                                .font(.subheadline)
                            if isSelected {
                                Text(item.0)
                                    .font(.subheadline)
                                    .fontWeight(.semibold)
                                    .transition(.move(edge: .leading).combined(with: .opacity))
                            }
                        }
                        .frame(width: chipWidth)
                        .padding(.vertical, 7)
                        .background(isSelected ? Color.accentColor : chipBackgroundColor)
                        .foregroundStyle(isSelected ? .white : .primary)
                        .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .frame(height: 34)
    }
}
