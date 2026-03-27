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
        ZStack {
            if viewModel.task == nil, viewModel.isLoading {
                ProgressView()
                    .transition(.opacity.combined(with: .scale))
            } else if viewModel.task == nil, let error = viewModel.loadingError {
                ErrorRetryView(message: error) {
                    Task { await viewModel.loadTask(id: taskId, apiClient: apiClient) }
                }
                .transition(.opacity.combined(with: .scale))
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
                .transition(.opacity)
                .overlay {
                    if viewModel.isLoading {
                        VStack(spacing: 8) {
                            ProgressView()
                            Text("Loading...")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        .padding(20)
                        .background(.ultraThinMaterial)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .transition(.opacity)
                    }
                }
            }
        }
        .animation(.easeInOut(duration: 0.2), value: viewModel.isLoading)
        .animation(.easeInOut(duration: 0.2), value: viewModel.loadingError)
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
        #if os(iOS)
        .toolbar(.hidden, for: .tabBar)
        #endif
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button("Edit", systemImage: "pencil") { showingEdit = true }
                    Button("Delete", systemImage: "trash", role: .destructive) { showingDelete = true }
                } label: {
                    Image(systemName: "ellipsis")
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
        .task(id: taskId) {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                await viewModel.refreshTask(id: taskId, apiClient: apiClient)
            }
        }
        .alert(
            "Error",
            isPresented: Binding(
                get: { viewModel.actionError != nil },
                set: { if !$0 { viewModel.actionError = nil } }
            )
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(viewModel.actionError ?? "")
        }
    }
}

// MARK: - Content View

struct TaskDetailContentView: View {
    let task: TaskDetail
    var onDeleteSessions: (IndexSet) -> Void
    var onNewChat: () -> Void
    var onStart: () -> Void
    var onStop: () -> Void
    var onRunNow: () -> Void

    @State private var sessionOffsetsToDelete: IndexSet?
    @State private var showingDocumentsSheet = false
    @State private var showingBriefingsSheet = false
    @State private var selectedDocument: DocumentSheetItem?

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
                        value: formatCountdown(nextRunAt)
                    )
                }

                if let runsAt = task.runsAt {
                    infoRow(
                        icon: "calendar.badge.clock",
                        iconColor: .blue,
                        label: "Runs At",
                        value: formatDate(runsAt)
                    )

                    if task.nextRunAt == nil, let seconds = secondsUntilDate(runsAt), seconds > 0 {
                        infoRow(
                            icon: "arrow.right.circle",
                            iconColor: .blue,
                            label: "Runs In",
                            value: formatCountdown(seconds)
                        )
                    }
                }

                if let tz = task.timezone {
                    infoRow(
                        icon: "globe",
                        iconColor: .secondary,
                        label: "Timezone",
                        value: tz
                    )
                }

                if let runsAt = task.runsAt, timezoneOffsetDiffers(runsAt),
                   let localTime = formatDateInLocalTimezone(runsAt)
                {
                    infoRow(
                        icon: "clock",
                        iconColor: .secondary,
                        label: "Local Time",
                        value: localTime
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

            // Tools & Extensions
            Section {
                NavigationLink(value: AppDestination.taskToolPermissions(taskId: task.id)) {
                    Label("Tool Permissions", systemImage: "wrench.and.screwdriver")
                }
                NavigationLink(value: AppDestination.taskExtensions(taskId: task.id)) {
                    Label("Extensions", systemImage: "puzzlepiece.extension")
                }
            }

            // Documents
            if let documents = task.documents, !documents.isEmpty {
                Section {
                    ForEach(documents) { doc in
                        Button {
                            selectedDocument = DocumentSheetItem(id: doc.id, title: doc.title)
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(doc.title)
                                        .font(.body)
                                        .foregroundStyle(.primary)
                                    if let createdAt = doc.createdAt {
                                        Text(formatSessionDateTime(createdAt))
                                            .font(.caption)
                                            .foregroundStyle(.tertiary)
                                    }
                                }
                                Spacer()
                                Text(doc.format.uppercased())
                                    .font(.caption2)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(.fill.tertiary)
                                    .clipShape(Capsule())
                            }
                        }
                    }
                } header: {
                    Button {
                        showingDocumentsSheet = true
                    } label: {
                        HStack {
                            Label("Documents (\(documents.count))", systemImage: "doc.text")
                            Spacer()
                            Text("See All")
                                .font(.caption)
                                .foregroundStyle(.blue)
                        }
                    }
                    .accessibilityIdentifier("documents-header")
                }
            }

            // Briefings
            if let briefings = task.briefings, !briefings.isEmpty {
                Section {
                    ForEach(briefings) { briefing in
                        Button {
                            showingBriefingsSheet = true
                        } label: {
                            HStack(spacing: 12) {
                                if let imageUrl = briefing.imageUrl,
                                   let url = URL(string: imageUrl)
                                {
                                    AsyncImage(url: url) { image in
                                        image
                                            .resizable()
                                            .aspectRatio(contentMode: .fill)
                                    } placeholder: {
                                        RoundedRectangle(cornerRadius: 8)
                                            .fill(.fill.tertiary)
                                    }
                                    .frame(width: 44, height: 44)
                                    .clipShape(RoundedRectangle(cornerRadius: 8))
                                }
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(briefing.title)
                                        .font(.body)
                                        .foregroundStyle(.primary)
                                    if let createdAt = briefing.createdAt {
                                        Text(formatSessionDateTime(createdAt))
                                            .font(.caption)
                                            .foregroundStyle(.tertiary)
                                    }
                                }
                            }
                        }
                    }
                } header: {
                    Button {
                        showingBriefingsSheet = true
                    } label: {
                        HStack {
                            Label("Briefings (\(briefings.count))", systemImage: "newspaper")
                            Spacer()
                            Text("See All")
                                .font(.caption)
                                .foregroundStyle(.blue)
                        }
                    }
                    .accessibilityIdentifier("briefings-header")
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
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(session.title ?? "Untitled")
                                        .font(.body)
                                    if let createdAt = session.createdAt {
                                        Text(formatSessionDateTime(createdAt))
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
                        .accessibilityIdentifier("chat-session-row-\(session.id)")
                    }
                    .onDelete { offsets in
                        sessionOffsetsToDelete = offsets
                    }
                }

                if task.status == "running" || task.status == "pending" {
                    Button {
                        onNewChat()
                    } label: {
                        Label("Start New Chat Session", systemImage: "plus.bubble")
                    }
                    .accessibilityIdentifier("start-chat-button")
                }
            } header: {
                NavigationLink(value: AppDestination.taskChatSessions(taskId: task.id)) {
                    HStack {
                        Label("Chat Sessions (\(task.chatSessions.count))", systemImage: "bubble.left.and.bubble.right")
                        Spacer()
                        Text("See All")
                            .font(.caption)
                            .foregroundStyle(.blue)
                    }
                }
                .accessibilityIdentifier("chat-sessions-header")
            }

            // Related Emails
            if !task.emails.isEmpty {
                Section {
                    ForEach(task.emails) { email in
                        NavigationLink(value: AppDestination.email(id: email.id)) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(email.subject ?? "No Subject")
                                    .font(.body)
                                Text("from: \(email.fromEmail)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                } header: {
                    Label("Related Emails (\(task.emails.count))", systemImage: "envelope")
                }
            }
        }
        .confirmationDialog(
            "Delete Chat Session?",
            isPresented: Binding(
                get: { sessionOffsetsToDelete != nil },
                set: { if !$0 { sessionOffsetsToDelete = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let offsets = sessionOffsetsToDelete {
                    onDeleteSessions(offsets)
                }
            }
        } message: {
            if let offsets = sessionOffsetsToDelete,
               let index = offsets.first,
               index < task.chatSessions.count
            {
                let session = task.chatSessions[index]
                Text("\"\(session.title ?? "Untitled")\" will be permanently deleted.")
            } else {
                Text("This chat session will be permanently deleted.")
            }
        }
        .sheet(isPresented: $showingDocumentsSheet) {
            TaskDocumentListSheet(taskId: task.id)
        }
        .sheet(isPresented: $showingBriefingsSheet) {
            TaskBriefingListSheet(taskId: task.id)
        }
        .sheet(item: $selectedDocument) { item in
            DocumentViewerSheet(documentId: item.id, initialTitle: item.title)
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
        if task.runsAt != nil {
            return "Scheduled"
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

    // MARK: - Timezone Helpers

    private func timezoneOffsetDiffers(_ dateString: String) -> Bool {
        guard let tz = parseTimezoneOffset(dateString) else { return false }
        return TimeZone.current.secondsFromGMT() != tz.secondsFromGMT()
    }

    private func formatDateInLocalTimezone(_ dateString: String) -> String? {
        guard let date = parseISO8601(dateString) else { return nil }
        let df = DateFormatter()
        df.timeZone = .current
        df.dateFormat = "MMM d 'at' h:mm a"
        let seconds = TimeZone.current.secondsFromGMT()
        let hours = seconds / 3600
        let mins = abs(seconds / 60 % 60)
        let offset = mins == 0
            ? String(format: "GMT%+d", hours)
            : String(format: "GMT%+d:%02d", hours, mins)
        return "\(df.string(from: date)) (\(TimeZone.current.identifier), \(offset))"
    }

    // MARK: - Formatting

    private func formatCountdown(_ seconds: Int) -> String {
        if seconds <= 0 { return "now" }
        let days = seconds / 86400
        let hours = (seconds % 86400) / 3600
        let minutes = (seconds % 3600) / 60
        if days > 0, hours > 0 {
            return "\(days)d \(hours)h"
        } else if days > 0 {
            return "\(days)d"
        } else if hours > 0, minutes > 0 {
            return "\(hours)h \(minutes)m"
        } else if hours > 0 {
            return "\(hours)h"
        } else {
            return "\(minutes)m"
        }
    }

    private func secondsUntilDate(_ dateString: String) -> Int? {
        guard let date = parseISO8601(dateString) else { return nil }
        return Int(date.timeIntervalSince(.now))
    }

    private func formatDate(_ dateString: String) -> String {
        guard let date = parseISO8601(dateString) else { return dateString }
        // Display in the original timezone from the ISO8601 string
        if let tz = parseTimezoneOffset(dateString) {
            let df = DateFormatter()
            df.timeZone = tz
            df.dateFormat = "MMM d 'at' h:mm a"
            return df.string(from: date)
        }
        return date.formatted(.dateTime.month().day().hour().minute())
    }

    private func parseTimezoneOffset(_ dateString: String) -> TimeZone? {
        if dateString.hasSuffix("Z") { return TimeZone(identifier: "UTC") }
        let pattern = /[+-]\d{2}:\d{2}$/
        guard let match = dateString.firstMatch(of: pattern) else { return nil }
        let offsetStr = String(match.output)
        let sign = offsetStr.hasPrefix("-") ? -1 : 1
        let parts = offsetStr.dropFirst().split(separator: ":")
        guard parts.count == 2,
              let hours = Int(parts[0]),
              let minutes = Int(parts[1])
        else { return nil }
        return TimeZone(secondsFromGMT: sign * (hours * 3600 + minutes * 60))
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

    private func formatSessionDateTime(_ dateString: String) -> String {
        guard let date = parseISO8601(dateString) else { return dateString }
        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return df.string(from: date)
    }
}

// MARK: - Header Card

struct TaskHeaderCard: View {
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

struct FlowLayout: View {
    let tags: [String]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
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
}

// MARK: - Action Buttons

struct TaskActionButtons: View {
    let task: TaskDetail
    var onStart: () -> Void
    var onStop: () -> Void
    var onRunNow: () -> Void

    private var isRunning: Bool {
        task.status == "running"
    }

    private var isPending: Bool {
        task.status == "pending"
    }

    private var isActiveOrPending: Bool {
        task.status == "running" || task.status == "pending"
    }

    private var hasAssignee: Bool {
        task.assigneeId != nil
    }

    var body: some View {
        HStack {
            Spacer()

            // Stop button when running or pending; Start button otherwise
            ZStack {
                if isRunning || isPending {
                    ContactStyleButton(
                        title: "Stop",
                        icon: "stop.fill",
                        action: onStop
                    )
                    .accessibilityIdentifier("stop-task-button")
                    .transition(.scale.combined(with: .opacity))
                } else {
                    ContactStyleButton(
                        title: "Start",
                        icon: "play.fill",
                        action: onStart
                    )
                    .accessibilityIdentifier("start-task-button")
                    .transition(.scale.combined(with: .opacity))
                }
            }
            .animation(.spring(response: 0.25, dampingFraction: 0.85), value: isRunning)

            // Run Now button (shown in running and pending states with an assignee)
            if hasAssignee, isActiveOrPending {
                Spacer()

                ContactStyleButton(
                    title: "Run Now",
                    icon: "bolt.fill",
                    action: onRunNow
                )
                .accessibilityIdentifier("run-now-button")
                .transition(.opacity)
            }

            Spacer()
        }
        .frame(maxWidth: .infinity)
        .animation(.easeInOut(duration: 0.2), value: isActiveOrPending)
    }
}

struct ContactStyleButton: View {
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

struct ScaleButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.6 : 1.0)
            .scaleEffect(configuration.isPressed ? 0.95 : 1.0)
            .animation(.easeInOut(duration: 0.15), value: configuration.isPressed)
    }
}

// MARK: - Preview

private let previewTaskJSON = """
{
    "id": "preview-task-1",
    "userId": "user-1",
    "assigneeId": "assignee-1",
    "title": "Weekly Report Generation",
    "description": "Automatically generate and send weekly performance reports to stakeholders every Monday morning.",
    "status": "running",
    "tags": ["automation", "reports", "weekly", "stakeholders", "performance"],
    "categories": ["Business", "Analytics"],
    "cronSchedule": "0 9 * * 1",
    "isCronEnabled": true,
    "nextRunAt": 172800,
    "createdAt": "2024-01-15T10:00:00Z",
    "updatedAt": "2024-03-19T08:30:00Z",
    "chatSessions": [
        {
            "id": "session-1",
            "title": "Report Generation - Mar 18",
            "status": "finished",
            "assigneeId": "assignee-1",
            "createdAt": "2024-03-18T09:00:00Z",
            "updatedAt": "2024-03-18T09:15:00Z"
        },
        {
            "id": "session-2",
            "title": "Report Generation - Mar 11",
            "status": "finished",
            "assigneeId": "assignee-1",
            "createdAt": "2024-03-11T09:00:00Z",
            "updatedAt": "2024-03-11T09:12:00Z"
        }
    ],
    "emails": []
}
"""

#Preview {
    let task = try! JSONDecoder().decode(TaskDetail.self, from: previewTaskJSON.data(using: .utf8)!)

    return NavigationStack {
        TaskDetailContentView(
            task: task,
            onDeleteSessions: { _ in },
            onNewChat: {},
            onStart: {},
            onStop: {},
            onRunNow: {}
        )
        .navigationTitle("Weekly Report Generation")
    }
}
