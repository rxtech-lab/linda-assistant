import AssistantCore
import SwiftUI

struct TaskFormSheet: View {
    enum Mode {
        case create
        case edit(TaskDetail)
    }

    let mode: Mode
    let onSave: (LindaTask) -> Void

    @Environment(AuthManager.self) private var authManager
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var description = ""
    @State private var status = "pending"
    @State private var tagsText = ""
    @State private var categoriesText = ""
    @State private var selectedAssigneeId: String? = nil
    @State private var availableAssignees: [Assignee] = []
    @State private var isCronEnabled = false
    @State private var cronSchedule = ""
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
                    TextField("Description", text: $description, axis: .vertical)
                        .lineLimit(3 ... 6)
                }

                Section("Status") {
                    Picker("Status", selection: $status) {
                        ForEach(TaskStatus.allCases, id: \.rawValue) { s in
                            Text(s.rawValue.capitalized).tag(s.rawValue)
                        }
                    }
                }

                Section("Assignee") {
                    Picker("Assignee", selection: $selectedAssigneeId) {
                        Text("None").tag(String?.none)
                        ForEach(availableAssignees) { assignee in
                            Text(assignee.name).tag(Optional(assignee.id))
                        }
                    }
                }

                Section("Schedule") {
                    Toggle("Enable cron schedule", isOn: $isCronEnabled)
                    if isCronEnabled {
                        TextField("Cron expression (e.g. 0 9 * * *)", text: $cronSchedule)
                            .font(.system(.body, design: .monospaced))
                            .autocorrectionDisabled()
                            #if os(iOS)
                            .textInputAutocapitalization(.never)
                            #endif
                        if !cronSchedule.trimmingCharacters(in: .whitespaces).isEmpty {
                            Text(cronSchedule.cronDescription)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                Section("Tags (comma-separated)") {
                    TextField("code, review, urgent", text: $tagsText)
                }

                Section("Categories (comma-separated)") {
                    TextField("engineering, design", text: $categoriesText)
                }

                if let error {
                    Section {
                        Text(error).foregroundStyle(.red)
                    }
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
            .task { await loadAssignees() }
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
        status = task.status ?? "pending"
        tagsText = task.tags?.joined(separator: ", ") ?? ""
        categoriesText = task.categories?.joined(separator: ", ") ?? ""
        selectedAssigneeId = task.assigneeId
        isCronEnabled = task.isCronEnabled ?? false
        cronSchedule = task.cronSchedule ?? ""
    }

    private func parseTags(_ text: String) -> [String]? {
        let tags = text.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        return tags.isEmpty ? nil : tags
    }

    private func save() async {
        isSubmitting = true
        error = nil

        let effectiveCronSchedule = isCronEnabled && !cronSchedule.trimmingCharacters(in: .whitespaces).isEmpty
            ? cronSchedule.trimmingCharacters(in: .whitespaces)
            : nil

        do {
            if case let .edit(existing) = mode {
                let body = UpdateTask(
                    title: title.trimmingCharacters(in: .whitespaces),
                    description: description.isEmpty ? nil : description,
                    status: status,
                    tags: parseTags(tagsText),
                    categories: parseTags(categoriesText),
                    assigneeId: selectedAssigneeId,
                    cronSchedule: effectiveCronSchedule,
                    isCronEnabled: isCronEnabled
                )
                let updated = try await apiClient.updateTask(id: existing.id, body)
                onSave(updated)
            } else {
                let body = CreateTask(
                    title: title.trimmingCharacters(in: .whitespaces),
                    description: description.isEmpty ? nil : description,
                    status: status,
                    tags: parseTags(tagsText),
                    categories: parseTags(categoriesText),
                    assigneeId: selectedAssigneeId,
                    cronSchedule: effectiveCronSchedule,
                    isCronEnabled: isCronEnabled
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
