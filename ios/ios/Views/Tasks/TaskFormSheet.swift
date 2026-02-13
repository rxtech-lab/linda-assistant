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
        }
        .presentationDetents([.large])
    }

    private func populateForEdit() {
        guard case let .edit(task) = mode else { return }
        title = task.title
        description = task.description ?? ""
        status = task.status ?? "pending"
        tagsText = task.tags?.joined(separator: ", ") ?? ""
        categoriesText = task.categories?.joined(separator: ", ") ?? ""
    }

    private func parseTags(_ text: String) -> [String]? {
        let tags = text.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        return tags.isEmpty ? nil : tags
    }

    private func save() async {
        isSubmitting = true
        error = nil

        do {
            if case let .edit(existing) = mode {
                let body = UpdateTask(
                    title: title.trimmingCharacters(in: .whitespaces),
                    description: description.isEmpty ? nil : description,
                    status: status,
                    tags: parseTags(tagsText),
                    categories: parseTags(categoriesText)
                )
                let updated = try await apiClient.updateTask(id: existing.id, body)
                onSave(updated)
            } else {
                let body = CreateTask(
                    title: title.trimmingCharacters(in: .whitespaces),
                    description: description.isEmpty ? nil : description,
                    status: status,
                    tags: parseTags(tagsText),
                    categories: parseTags(categoriesText)
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
