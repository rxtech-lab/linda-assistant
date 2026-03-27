import AssistantCore
import SwiftUI

struct EmailToTaskSheet: View {
    let email: Email
    var onCreated: ((LindaTask) -> Void)?

    @Environment(AuthManager.self) private var authManager
    @Environment(\.dismiss) private var dismiss
    @State private var instruction = ""
    @State private var selectedAssigneeId: String?
    @State private var assignees: [Assignee] = []
    @State private var defaultEmailAssigneeId: String?
    @State private var isLoading = false
    @State private var error: String?

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Email") {
                    LabeledContent("Subject", value: email.subject ?? "(no subject)")
                    LabeledContent("From", value: email.fromName ?? email.fromEmail)
                }

                Section("Task Instruction") {
                    TextField("Process the email", text: $instruction, axis: .vertical)
                        .lineLimit(3 ... 6)
                }

                Section {
                    Picker("Assignee", selection: $selectedAssigneeId) {
                        Text("None").tag(String?.none)
                        ForEach(assignees, id: \.id) { assignee in
                            Text(assignee.name).tag(Optional(assignee.id))
                        }
                    }
                } header: {
                    Text("Assignee")
                } footer: {
                    if selectedAssigneeId == nil, defaultEmailAssigneeId == nil {
                        Text(
                            "An assignee is required to process the email. Select one here or set a default in Settings."
                        )
                        .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Create Task from Email")
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
                .alert("Error", isPresented: .init(
                    get: { error != nil },
                    set: { if !$0 { error = nil } }
                )) {
                    Button("OK") { error = nil }
                } message: {
                    Text(error ?? "")
                }
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Create") {
                            Task { await createTask() }
                        }
                        .disabled(isLoading || (selectedAssigneeId == nil && defaultEmailAssigneeId == nil))
                    }
                }
                .task {
                    await loadAssignees()
                }
        }
        .presentationDetents([.medium, .large])
    }

    private func loadAssignees() async {
        do {
            async let fetchAssignees = apiClient.listAssignees()
            async let fetchSettings = apiClient.getUserSettings()
            assignees = try await fetchAssignees.data
            let settings = try await fetchSettings
            defaultEmailAssigneeId = settings.defaultEmailAssigneeId
            if selectedAssigneeId == nil, let defaultId = settings.defaultEmailAssigneeId {
                selectedAssigneeId = defaultId
            }
        } catch {
            // Non-critical
        }
    }

    private func createTask() async {
        isLoading = true
        error = nil
        do {
            let taskDescription = instruction.isEmpty ? "Process the email" : instruction
            let task = try await apiClient.createTask(
                CreateTask(
                    title: "Email: \(email.subject ?? "(no subject)")",
                    description: taskDescription,
                    source: TaskSource.email.rawValue,
                    emailId: email.id,
                    execute: selectedAssigneeId != nil ? true : nil,
                    assigneeId: selectedAssigneeId
                )
            )
            onCreated?(task)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}
