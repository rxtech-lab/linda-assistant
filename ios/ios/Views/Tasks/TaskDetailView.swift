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
                TaskDetailContentView(
                    task: task,
                    onDeleteSessions: { offsets in
                        Task {
                            await viewModel.deleteChatSessions(
                                at: offsets,
                                apiClient: apiClient,
                                eventManager: eventManager
                            )
                        }
                    },
                    onNewChat: { showingNewChat = true },
                    onStart: {
                        Task { await viewModel.startTask(apiClient: apiClient, eventManager: eventManager) }
                    },
                    onStop: {
                        Task { await viewModel.stopTask(apiClient: apiClient, eventManager: eventManager) }
                    },
                    onRunNow: {
                        Task { await viewModel.executeNow(apiClient: apiClient, eventManager: eventManager) }
                    }
                )
            }
        }
        .navigationTitle(viewModel.task?.title ?? "Task")
        .navigationDestination(for: AppDestination.self) { destination in
            switch destination {
            case let .task(id): TaskDetailView(taskId: id)
            case let .chatSession(id): ChatDetailView(sessionId: id)
            case let .email(id): EmailDetailView(emailId: id)
            case let .assignee(id, name): AssigneeDetailView(assigneeId: id, assigneeName: name)

            }
        }
        #if os(iOS)
        .toolbar(.hidden, for: .tabBar)
        #endif
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

// MARK: - Content View

private struct TaskDetailContentView: View {
    let task: TaskDetail
    var onDeleteSessions: (IndexSet) -> Void
    var onNewChat: () -> Void
    var onStart: () -> Void
    var onStop: () -> Void
    var onRunNow: () -> Void

    var body: some View {
        List {
            // Hero Header & Actions
            Section {
                VStack(spacing: 12) {
                    TaskHeaderCard(task: task)
                    TaskActionButtons(
                        task: task,
                        onStart: onStart,
                        onStop: onStop,
                        onRunNow: onRunNow
                    )
                }
            }
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)

            // Status & Schedule
            Section {
                statusRow
                scheduleRow

                if let nextRunAt = task.nextRunAt {
                    infoRow(
                        icon: "arrow.right.circle",
                        iconColor: .blue,
                        label: "Next Run",
                        value: formatNextRun(nextRunAt)
                    )
                } else if let runsAt = task.runsAt {
                    infoRow(
                        icon: "arrow.right.circle",
                        iconColor: .blue,
                        label: "Runs At",
                        value: formatDate(runsAt)
                    )
                }

                if let lastRun = lastRunDate {
                    infoRow(
                        icon: "clock.arrow.circlepath",
                        iconColor: .secondary,
                        label: "Last Run",
                        value: formatRelativeDate(lastRun)
                    )
                }
            } header: {
                Label("Status & Schedule", systemImage: "clock")
            }

            // Description
            if let description = task.description, !description.isEmpty {
                Section {
                    Text(description)
                        .font(.body)
                } header: {
                    Label("Description", systemImage: "text.alignleft")
                }
            }

            // Labels (Tags + Categories)
            if hasTags || hasCategories {
                Section {
                    if let tags = task.tags, !tags.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Tags")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            FlowLayout(tags: tags)
                        }
                        .padding(.vertical, 2)
                    }
                    if let categories = task.categories, !categories.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Categories")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            FlowLayout(tags: categories)
                        }
                        .padding(.vertical, 2)
                    }
                } header: {
                    Label("Labels", systemImage: "tag")
                }
            }

            // Chat Sessions
            Section {
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
                        .accessibilityIdentifier("chat-session-row-\(session.id)")
                    }
                    .onDelete { offsets in
                        onDeleteSessions(offsets)
                    }
                }

                Button {
                    onNewChat()
                } label: {
                    Label("Start New Chat Session", systemImage: "plus.bubble")
                }
                .accessibilityIdentifier("start-chat-button")
            } header: {
                Label("Chat Sessions (\(task.chatSessions.count))", systemImage: "bubble.left.and.bubble.right")
            }

            // Related Emails
            if !task.emails.isEmpty {
                Section {
                    ForEach(task.emails) { email in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(email.subject ?? "No Subject")
                                .font(.body)
                            Text("from: \(email.fromEmail)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                } header: {
                    Label("Related Emails (\(task.emails.count))", systemImage: "envelope")
                }
            }
        }
    }

    // MARK: - Info Rows

    private var statusRow: some View {
        HStack {
            Image(systemName: "circle.fill")
                .font(.caption2)
                .foregroundStyle(statusColor(task.status))
            Text("Status")
            Spacer()
            Text(task.status?.capitalized ?? "Unknown")
                .foregroundStyle(.secondary)
        }
    }

    private var scheduleRow: some View {
        HStack {
            Image(systemName: scheduleIcon)
                .foregroundStyle(.secondary)
                .frame(width: 20)
            Text("Schedule")
            Spacer()
            Text(scheduleDetail)
                .foregroundStyle(.secondary)
        }
    }

    private func infoRow(icon: String, iconColor: Color, label: String, value: String) -> some View {
        HStack {
            Image(systemName: icon)
                .foregroundStyle(iconColor)
                .frame(width: 20)
            Text(label)
            Spacer()
            Text(value)
                .foregroundStyle(.secondary)
        }
    }

    // MARK: - Computed Properties

    private var hasTags: Bool {
        task.tags != nil && !(task.tags?.isEmpty ?? true)
    }

    private var hasCategories: Bool {
        task.categories != nil && !(task.categories?.isEmpty ?? true)
    }

    private var scheduleIcon: String {
        if task.isCronEnabled == true { return "clock.arrow.2.circlepath" }
        if task.runsAt != nil { return "calendar.badge.clock" }
        return "hand.tap"
    }

    private var scheduleDetail: String {
        if task.isCronEnabled == true, let cron = task.cronSchedule {
            return cron
        }
        if let runsAt = task.runsAt {
            return formatDate(runsAt)
        }
        return "Manual"
    }

    private var lastRunDate: Date? {
        let dates = task.chatSessions.compactMap { session -> Date? in
            guard let updatedAt = session.updatedAt else { return nil }
            return parseISO8601(updatedAt)
        }
        return dates.max()
    }

    // MARK: - Formatting

    private func formatNextRun(_ seconds: Int) -> String {
        let target = Date.now.addingTimeInterval(TimeInterval(seconds))
        if seconds < 86400 {
            let formatter = RelativeDateTimeFormatter()
            formatter.unitsStyle = .full
            return formatter.localizedString(for: target, relativeTo: .now)
        } else {
            return target.formatted(.dateTime.month().day().hour().minute())
        }
    }

    private func formatDate(_ dateString: String) -> String {
        guard let date = parseISO8601(dateString) else { return dateString }
        return date.formatted(.dateTime.month().day().hour().minute())
    }

    private func formatRelativeDate(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        return formatter.localizedString(for: date, relativeTo: .now)
    }

    private func parseISO8601(_ string: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: string) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: string)
    }

    private func statusColor(_ status: String?) -> Color {
        switch status?.lowercased() {
        case "pending", "starting": .orange
        case "running", "in_progress": .blue
        case "finished", "stopped": .green
        case "cancelled": .secondary
        default: .secondary
        }
    }
}

// MARK: - Header Card

private struct TaskHeaderCard: View {
    let task: TaskDetail

    var body: some View {
        VStack(spacing: 16) {
            ZStack {
                Circle()
                    .fill(
                        LinearGradient(
                            colors: gradientColors,
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 80, height: 80)

                Image(systemName: statusIcon)
                    .font(.system(size: 32, weight: .bold))
                    .foregroundStyle(.white)
            }

            VStack(spacing: 4) {
                Text(task.title)
                    .font(.title2.weight(.semibold))
                    .multilineTextAlignment(.center)

                HStack(spacing: 6) {
                    Circle()
                        .fill(statusColor)
                        .frame(width: 8, height: 8)
                    Text(task.status?.capitalized ?? "Unknown")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }

            HStack(spacing: 6) {
                Image(systemName: scheduleIcon)
                    .font(.caption)
                Text(scheduleLabel)
                    .font(.caption.weight(.medium))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(.fill.tertiary)
            .clipShape(Capsule())
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 16)
        .padding(.bottom, 8)
    }

    private var gradientColors: [Color] {
        switch task.status?.lowercased() {
        case "running", "in_progress": [.blue, .cyan]
        case "pending", "starting": [.orange, .yellow]
        case "finished": [.green, .mint]
        case "stopped", "cancelled": [.gray, .secondary]
        default: [.gray, .secondary]
        }
    }

    private var statusIcon: String {
        switch task.status?.lowercased() {
        case "running", "in_progress": "bolt.fill"
        case "pending", "starting": "clock.fill"
        case "finished": "checkmark"
        case "stopped": "stop.fill"
        case "cancelled": "xmark"
        default: "questionmark"
        }
    }

    private var statusColor: Color {
        switch task.status?.lowercased() {
        case "pending", "starting": .orange
        case "running", "in_progress": .blue
        case "finished", "stopped": .green
        case "cancelled": .secondary
        default: .secondary
        }
    }

    private var scheduleIcon: String {
        if task.isCronEnabled == true { return "clock.arrow.2.circlepath" }
        if task.runsAt != nil { return "calendar.badge.clock" }
        return "hand.tap"
    }

    private var scheduleLabel: String {
        if task.isCronEnabled == true { return "Recurring" }
        if task.runsAt != nil { return "Scheduled" }
        return "Manual"
    }
}

// MARK: - Flow Layout

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
// MARK: - Action Buttons

private struct TaskActionButtons: View {
    let task: TaskDetail
    var onStart: () -> Void
    var onStop: () -> Void
    var onRunNow: () -> Void

    private var isRunning: Bool {
        task.status == "running"
    }

    private var hasAssignee: Bool {
        task.assigneeId != nil
    }

    var body: some View {
        HStack {
            Spacer()
            
            // Start/Stop button
            ContactStyleButton(
                title: isRunning ? "Stop" : "Start",
                icon: isRunning ? "stop.fill" : "play.fill",
                action: isRunning ? onStop : onStart
            )
            .accessibilityIdentifier(isRunning ? "stop-task-button" : "start-task-button")

            // Run Now button (only if has assignee)
            if hasAssignee {
                Spacer()
                
                ContactStyleButton(
                    title: "Run Now",
                    icon: "bolt.fill",
                    action: onRunNow
                )
                .accessibilityIdentifier("run-now-button")
            }
            
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }
}

private struct ContactStyleButton: View {
    let title: String
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 24, weight: .medium))
                    .frame(width: 56, height: 56)
                    .background(.fill.tertiary)
                    .clipShape(Circle())

                Text(title)
                    .font(.caption)
            }
            .foregroundStyle(.primary)
        }
        .buttonStyle(ScaleButtonStyle())
    }
}

private struct ScaleButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.6 : 1.0)
            .scaleEffect(configuration.isPressed ? 0.95 : 1.0)
            .animation(.easeInOut(duration: 0.15), value: configuration.isPressed)
    }
}

