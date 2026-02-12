import AssistantCore
import SwiftUI

struct AssigneeFormSheet: View {
    enum Mode {
        case create
        case edit(Assignee)
    }

    let mode: Mode
    let onSave: (Assignee) -> Void

    @Environment(AuthManager.self) private var authManager
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var email = ""
    @State private var personality = ""
    @State private var selectedModel = ""
    @State private var availableModels: [String] = []
    @State private var availableTools: [AgentTool] = []
    @State private var toolPermissions: [String: String] = [:]
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
                Section("Info") {
                    TextField("Name", text: $name)
                    TextField("Email", text: $email)
                        .emailFieldInputModifiers()
                }

                Section("Personality") {
                    TextField("System prompt...", text: $personality, axis: .vertical)
                        .lineLimit(4 ... 8)
                }

                if !availableModels.isEmpty {
                    Section("Model") {
                        Picker("Model", selection: $selectedModel) {
                            ForEach(availableModels, id: \.self) { model in
                                Text(model).tag(model)
                            }
                        }
                    }
                }

                if !availableTools.isEmpty {
                    Section("Tool Permissions") {
                        ForEach(availableTools) { tool in
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(tool.name).font(.body)
                                    Text(tool.description).font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Picker("", selection: bindingForTool(tool.name)) {
                                    Text("Auto").tag("auto-confirm")
                                    Text("Manual").tag("manual-confirm")
                                    Text("Reject").tag("auto-reject")
                                }
                                .labelsHidden()
                            }
                        }
                    }
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
                        .foregroundStyle(Color.primaryButtonColor)
                        .disabled(name.isEmpty || email.isEmpty || isSubmitting)
                    }
                #endif
            }
            .formStyle(.grouped)
            .navigationTitle(isEdit ? "Edit Assistant" : "New Assistant")
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
                        .disabled(name.isEmpty || email.isEmpty)
                    }
                }
            }
            .task {
                await loadModelsAndTools()
                populateForEdit()
            }
        }
        .presentationDetents([.large])
    }

    private func bindingForTool(_ toolName: String) -> Binding<String> {
        Binding(
            get: { toolPermissions[toolName] ?? "auto-confirm" },
            set: { toolPermissions[toolName] = $0 }
        )
    }

    private func loadModelsAndTools() async {
        do {
            async let modelsReq = apiClient.listModels()
            async let toolsReq = apiClient.listTools()
            let (models, tools) = try await (modelsReq, toolsReq)
            availableModels = models
            availableTools = tools
            if selectedModel.isEmpty, let first = models.first {
                selectedModel = first
            }
            for tool in tools where toolPermissions[tool.name] == nil {
                toolPermissions[tool.name] = tool.defaultPermission
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func populateForEdit() {
        guard case let .edit(assignee) = mode else { return }
        name = assignee.name
        email = assignee.email
        personality = assignee.personality ?? ""
        selectedModel = assignee.model ?? ""
        if let perms = assignee.toolPermissions {
            for perm in perms {
                toolPermissions[perm.toolName] = perm.permission
            }
        }
    }

    private func save() async {
        isSubmitting = true
        error = nil

        let permissions = toolPermissions.map { ToolPermission(toolName: $0.key, permission: $0.value) }

        do {
            if case let .edit(existing) = mode {
                let body = UpdateAssignee(
                    name: name.trimmingCharacters(in: .whitespaces),
                    email: email.trimmingCharacters(in: .whitespaces),
                    personality: personality.isEmpty ? nil : personality,
                    model: selectedModel.isEmpty ? nil : selectedModel,
                    toolPermissions: permissions.isEmpty ? nil : permissions
                )
                let updated = try await apiClient.updateAssignee(id: existing.id, body)
                onSave(updated)
            } else {
                let body = CreateAssignee(
                    name: name.trimmingCharacters(in: .whitespaces),
                    email: email.trimmingCharacters(in: .whitespaces),
                    personality: personality.isEmpty ? nil : personality,
                    model: selectedModel.isEmpty ? nil : selectedModel,
                    toolPermissions: permissions.isEmpty ? nil : permissions
                )
                let created = try await apiClient.createAssignee(body)
                onSave(created)
            }
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }

        isSubmitting = false
    }
}

private extension View {
    @ViewBuilder
    func emailFieldInputModifiers() -> some View {
        #if os(iOS)
            textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
        #else
            self
        #endif
    }
}
