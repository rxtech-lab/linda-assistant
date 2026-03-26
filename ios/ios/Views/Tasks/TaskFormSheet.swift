import AssistantCore
import SwiftUI

struct TaskFormSheet: View {
    enum Mode {
        case create
        case edit(TaskDetail)
    }

    enum ScheduleType: String, CaseIterable {
        case none = "None"
        case cron = "Recurring (Cron)"
        case scheduled = "Scheduled"
    }

    let mode: Mode
    let onSave: (LindaTask) -> Void

    @Environment(AuthManager.self) private var authManager
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var description = ""
    @State private var tagsText = ""
    @State private var categoriesText = ""
    @State private var selectedAssigneeId: String? = nil
    @State private var availableAssignees: [Assignee] = []
    @State private var scheduleType: ScheduleType = .none
    @State private var cronSchedule = ""
    @State private var runsAtDate = Date().addingTimeInterval(3600)
    @State private var selectedTimezone = TimeZone.current.identifier
    @State private var isSubmitting = false
    @State private var error: String?

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    private var isEdit: Bool {
        if case .edit = mode { return true }
        return false
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Details") {
                    TextField("Title", text: $title)
                        .accessibilityIdentifier("task-title-field")
                    TextField("Description", text: $description, axis: .vertical)
                        .lineLimit(3 ... 6)
                        .accessibilityIdentifier("task-description-field")
                }

                Section("Assignee") {
                    Picker("Assignee", selection: $selectedAssigneeId) {
                        Text("None").tag(String?.none)
                        ForEach(availableAssignees) { assignee in
                            Text(assignee.name).tag(Optional(assignee.id))
                        }
                    }
                    .accessibilityIdentifier("task-assignee-picker")
                }

                Section("Schedule") {
                    Picker("Type", selection: $scheduleType) {
                        ForEach(ScheduleType.allCases, id: \.self) { type in
                            Text(type.rawValue).tag(type)
                        }
                    }
                    .accessibilityIdentifier("task-schedule-type-picker")

                    switch scheduleType {
                        case .cron:
                            CronExpressionView(cronExpression: $cronSchedule)
                            Picker("Timezone", selection: $selectedTimezone) {
                                ForEach(TimeZone.knownTimeZoneIdentifiers, id: \.self) { tz in
                                    Text(timezoneLabel(tz)).tag(tz)
                                }
                            }
                            .accessibilityIdentifier("task-cron-timezone-picker")
                        case .scheduled:
                            DatePicker(
                                "Run at",
                                selection: $runsAtDate,
                                in: Date()...,
                                displayedComponents: [.date, .hourAndMinute]
                            )
                            .accessibilityIdentifier("task-runs-at-picker")
                            Picker("Timezone", selection: $selectedTimezone) {
                                ForEach(TimeZone.knownTimeZoneIdentifiers, id: \.self) { tz in
                                    Text(timezoneLabel(tz)).tag(tz)
                                }
                            }
                            .accessibilityIdentifier("task-timezone-picker")
                        case .none:
                            EmptyView()
                    }
                }

                Section("Tags (comma-separated)") {
                    TextField("code, review, urgent", text: $tagsText)
                }

                Section("Categories (comma-separated)") {
                    TextField("engineering, design", text: $categoriesText)
                }

                #if os(iOS)
                    Section {
                        Button {
                            Task { await save() }
                        } label: {
                            if isSubmitting {
                                ProgressView().frame(maxWidth: .infinity)
                            } else {
                                Text("Save").frame(maxWidth: .infinity)
                            }
                        }
                        .accessibilityIdentifier("task-save-button")
                        .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty || isSubmitting)
                    }
                #endif
            }
            .formStyle(.grouped)
            .navigationTitle(isEdit ? "Edit Task" : "New Task")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSubmitting {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Button("Save") {
                            Task { await save() }
                        }
                        .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
            .onAppear { populateForEdit() }
            .onChange(of: scheduleType) { _, newValue in
                if newValue == .cron, cronSchedule.trimmingCharacters(in: .whitespaces).isEmpty {
                    cronSchedule = CronGUIState().toCronExpression()
                }
            }
            .task { await loadAssignees() }
            .alert("Error", isPresented: .init(
                get: { error != nil },
                set: { if !$0 { error = nil } }
            )) {
                Button("OK") { error = nil }
            } message: {
                Text(error ?? "")
            }
        }
        .presentationDetents([.large])
    }

    private func loadAssignees() async {
        do {
            let response = try await apiClient.listAssignees(limit: 100)
            availableAssignees = response.data
        } catch {
            // Non-critical — assignee picker just stays empty
        }
    }

    private func populateForEdit() {
        guard case let .edit(task) = mode else { return }
        title = task.title
        description = task.description ?? ""
        tagsText = task.tags?.joined(separator: ", ") ?? ""
        categoriesText = task.categories?.joined(separator: ", ") ?? ""
        selectedAssigneeId = task.assigneeId
        cronSchedule = task.cronSchedule ?? ""

        // Use server-stored timezone if available
        if let tz = task.timezone, TimeZone(identifier: tz) != nil {
            selectedTimezone = tz
        }

        if task.isCronEnabled == true {
            scheduleType = .cron
        } else if let runsAt = task.runsAt, let date = ISO8601DateFormatter().date(from: runsAt) {
            scheduleType = .scheduled
            // Convert the stored date to wall-clock components in the task's timezone for the DatePicker
            let taskTZ = TimeZone(identifier: selectedTimezone) ?? .current
            var sourceCal = Calendar.current
            sourceCal.timeZone = taskTZ
            let components = sourceCal.dateComponents(
                [.year, .month, .day, .hour, .minute, .second], from: date
            )
            runsAtDate = Calendar.current.date(from: components) ?? date
        } else {
            scheduleType = .none
        }
    }

    private func timezoneLabel(_ identifier: String) -> String {
        guard let tz = TimeZone(identifier: identifier) else { return identifier }
        let seconds = tz.secondsFromGMT()
        let hours = seconds / 3600
        let minutes = abs(seconds / 60 % 60)
        let offset = minutes == 0
            ? String(format: "GMT%+d", hours)
            : String(format: "GMT%+d:%02d", hours, minutes)
        return "\(identifier) (\(offset))"
    }

    private func parseTags(_ text: String) -> [String]? {
        let tags = text.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        return tags.isEmpty ? nil : tags
    }

    private func save() async {
        isSubmitting = true
        error = nil

        let effectiveCronSchedule = scheduleType == .cron && !cronSchedule.trimmingCharacters(in: .whitespaces).isEmpty
            ? cronSchedule.trimmingCharacters(in: .whitespaces)
            : nil
        let effectiveRunsAt: String? = if scheduleType == .scheduled {
            {
                let targetTZ = TimeZone(identifier: selectedTimezone) ?? .current
                // DatePicker shows time in local timezone — reinterpret as target timezone
                let localComponents = Calendar.current.dateComponents(
                    [.year, .month, .day, .hour, .minute, .second], from: runsAtDate
                )
                var targetCalendar = Calendar.current
                targetCalendar.timeZone = targetTZ
                let targetDate = targetCalendar.date(from: localComponents) ?? runsAtDate
                let formatter = ISO8601DateFormatter()
                formatter.timeZone = targetTZ
                formatter.formatOptions = [.withInternetDateTime]
                return formatter.string(from: targetDate)
            }()
        } else {
            nil
        }
        let effectiveIsCronEnabled = scheduleType == .cron
        let effectiveTimezone = scheduleType != .none ? selectedTimezone : nil

        do {
            if case let .edit(existing) = mode {
                let body = UpdateTask(
                    title: title.trimmingCharacters(in: .whitespaces),
                    description: description.isEmpty ? nil : description,
                    tags: parseTags(tagsText),
                    categories: parseTags(categoriesText),
                    assigneeId: selectedAssigneeId,
                    cronSchedule: effectiveCronSchedule,
                    isCronEnabled: effectiveIsCronEnabled,
                    runsAt: effectiveRunsAt,
                    timezone: effectiveTimezone
                )
                let updated = try await apiClient.updateTask(id: existing.id, body)
                onSave(updated)
            } else {
                let body = CreateTask(
                    title: title.trimmingCharacters(in: .whitespaces),
                    description: description.isEmpty ? nil : description,
                    tags: parseTags(tagsText),
                    categories: parseTags(categoriesText),
                    assigneeId: selectedAssigneeId,
                    cronSchedule: effectiveCronSchedule,
                    isCronEnabled: effectiveIsCronEnabled,
                    runsAt: effectiveRunsAt,
                    timezone: effectiveTimezone
                )
                let created = try await apiClient.createTask(body)
                onSave(created)
            }
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }

        isSubmitting = false
    }
}
