import AssistantCore
import SwiftUI

struct NewChatSheet: View {
    let taskId: String?
    @Environment(AuthManager.self) private var authManager
    @Environment(EventManager.self) private var eventManager
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var assignees: [Assignee] = []
    @State private var selectedAssigneeId: String?
    @State private var isSubmitting = false
    @State private var error: String?

    init(taskId: String? = nil) {
        self.taskId = taskId
    }

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Chat Title") {
                    TextField("Optional title", text: $title)
                }

                if !assignees.isEmpty {
                    Section("Assistant") {
                        Picker("Assistant", selection: $selectedAssigneeId) {
                            ForEach(assignees) { assignee in
                                Text(assignee.name).tag(assignee.id as String?)
                            }
                        }
                    }
                }

                if let error {
                    Section {
                        Text(error).foregroundStyle(.red)
                    }
                }

                Section {
                    Button {
                        Task { await createSession() }
                    } label: {
                        if isSubmitting {
                            ProgressView().frame(maxWidth: .infinity)
                        } else {
                            Text("Start Chat").frame(maxWidth: .infinity)
                        }
                    }
                    .disabled(isSubmitting)
                }
            }
            .formStyle(.grouped)
            .navigationTitle("New Chat")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .task {
                do {
                    let response = try await apiClient.listAssignees()
                    assignees = response.data
                    if selectedAssigneeId == nil, let first = assignees.first {
                        selectedAssigneeId = first.id
                    }
                } catch {
                    self.error = error.localizedDescription
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func createSession() async {
        isSubmitting = true
        error = nil

        let body = CreateChatSession(
            taskId: taskId,
            assigneeId: selectedAssigneeId,
            title: title.isEmpty ? nil : title
        )

        do {
            let session = try await apiClient.createChatSession(body)
            eventManager.emit(.chatSessionCreated(session))
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }

        isSubmitting = false
    }
}
