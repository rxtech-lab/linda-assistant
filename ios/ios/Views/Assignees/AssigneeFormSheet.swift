import AssistantCore
import SwiftUI

struct AssigneeFormSheet: View {
    enum Mode {
        case create
        case edit(String)
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
    @State private var toolConditions: [String: [ToolCondition]] = [:]
    @State private var toolConditionLogics: [String: String] = [:]
    @State private var isSubmitting = false
    @State private var isLoadingFormData = false
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
                            ToolPermissionRow(
                                permission: ToolPermission(
                                    toolName: tool.name,
                                    permission: toolPermissions[tool.name] ?? tool.defaultPermission,
                                    conditions: toolConditions[tool.name],
                                    conditionLogic: toolConditionLogics[tool.name]
                                ),
                                tool: tool
                            ) { newPermission in
                                toolPermissions[tool.name] = newPermission
                                if newPermission != "auto-confirm" {
                                    toolConditions[tool.name] = nil
                                    toolConditionLogics[tool.name] = nil
                                }
                            } onConditionsChange: { newConditions in
                                toolConditions[tool.name] = newConditions.isEmpty ? nil : newConditions
                            } onConditionLogicChange: { newLogic in
                                toolConditionLogics[tool.name] = newLogic
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
                await loadFormData()
            }
            .overlay(alignment: .center) {
                if isLoadingFormData {
                    VStack(spacing: 12) {
                        ProgressView()
                        Text("Loading settings")
                    }
                    .padding()
                    .glassEffect(in: .rect(cornerRadius: 24))
                }
            }
        }
        .presentationDetents([.large])
    }

    private func loadFormData() async {
        isLoadingFormData = true
        defer { isLoadingFormData = false }

        do {
            let assigneeId: String? = { if case let .edit(id) = mode { return id }
                return nil
            }()
            let formData = try await apiClient.getAssigneeFormSchema(id: assigneeId)
            availableModels = formData.models
            availableTools = formData.tools

            if let assignee = formData.assignee {
                name = assignee.name
                email = assignee.email
                personality = assignee.personality ?? ""
                selectedModel = assignee.model ?? ""
                if let perms = assignee.toolPermissions {
                    for perm in perms {
                        toolPermissions[perm.toolName] = perm.permission
                        if let conditions = perm.conditions, !conditions.isEmpty {
                            toolConditions[perm.toolName] = conditions
                        }
                        if let logic = perm.conditionLogic {
                            toolConditionLogics[perm.toolName] = logic
                        }
                    }
                }
            }

            if selectedModel.isEmpty, let first = formData.models.first {
                selectedModel = first
            }
            for tool in formData.tools where toolPermissions[tool.name] == nil {
                toolPermissions[tool.name] = tool.defaultPermission
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func save() async {
        isSubmitting = true
        error = nil

        let permissions = toolPermissions
            .filter { entry in
                // Exclude tools that cannot have their permission changed
                !(availableTools.first(where: { $0.name == entry.key })?.disablePermissionChange == true)
            }
            .map { entry in
                let conditions: [ToolCondition]? = entry.value == "auto-confirm"
                    ? (toolConditions[entry.key]?.isEmpty == false ? toolConditions[entry.key] : nil)
                    : nil
                let logic: String? = conditions != nil ? toolConditionLogics[entry.key] : nil
                return ToolPermission(
                    toolName: entry.key,
                    permission: entry.value,
                    conditions: conditions,
                    conditionLogic: logic
                )
            }

        do {
            if case let .edit(assigneeId) = mode {
                let body = UpdateAssignee(
                    name: name.trimmingCharacters(in: .whitespaces),
                    email: email.trimmingCharacters(in: .whitespaces),
                    personality: personality.isEmpty ? nil : personality,
                    model: selectedModel.isEmpty ? nil : selectedModel,
                    toolPermissions: permissions.isEmpty ? nil : permissions
                )
                let updated = try await apiClient.updateAssignee(id: assigneeId, body)
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
