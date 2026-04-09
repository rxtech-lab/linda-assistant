import AssistantCore
import SwiftUI

struct OnboardingView: View {
    let onComplete: () -> Void
    @Environment(AuthManager.self) private var authManager
    @Environment(EventManager.self) private var eventManager
    @State private var viewModel = OnboardingViewModel()

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    private var isPreview: Bool {
        ProcessInfo.processInfo.environment["XCODE_RUNNING_FOR_PREVIEWS"] == "1"
    }

    private var isSubmitButtonEnable: Bool {
        viewModel.isValid && !viewModel.isSubmitting
    }

    private var submitButtonPlacement: ToolbarItemPlacement {
        #if os(iOS)
            .bottomBar
        #else
            .confirmationAction
        #endif
    }

    var body: some View {
        Form {
            Section("Assistant Info") {
                TextField("Name", text: $viewModel.name)
                TextField("Email", text: $viewModel.email)
                    .emailFieldInputModifiers()
            }

            Section("Personality") {
                TextField("System prompt...", text: $viewModel.personality, axis: .vertical)
                    .lineLimit(4 ... 8)
            }

            if !viewModel.availableModels.isEmpty {
                Section("Model") {
                    Picker("Model", selection: $viewModel.selectedModel) {
                        ForEach(viewModel.availableModels) { model in
                            Text(model.modelId).tag(model.modelId)
                        }
                    }
                }
            }

            if !viewModel.availableTools.isEmpty {
                Section("Tool Permissions") {
                    ForEach(viewModel.availableTools) { tool in
                        ToolPermissionRow(
                            permission: ToolPermission(
                                toolName: tool.name,
                                permission: viewModel.toolPermissions[tool.name] ?? tool.defaultPermission,
                                conditions: viewModel.toolConditions[tool.name],
                                conditionLogic: viewModel.toolConditionLogics[tool.name]
                            ),
                            tool: tool
                        ) { newPermission in
                            viewModel.toolPermissions[tool.name] = newPermission
                            if newPermission != "auto-confirm" {
                                viewModel.toolConditions[tool.name] = nil
                                viewModel.toolConditionLogics[tool.name] = nil
                            }
                        } onConditionsChange: { newConditions in
                            viewModel.toolConditions[tool.name] = newConditions.isEmpty ? nil : newConditions
                        } onConditionLogicChange: { newLogic in
                            viewModel.toolConditionLogics[tool.name] = newLogic
                        }
                    }
                }
            }
        }
        .formStyle(.grouped)
        #if os(iOS)
            .navigationTitle("Welcome to Linda")
        #endif
            .task {
                await viewModel.loadModelsAndTools(apiClient: apiClient)
            }
            .toolbar {
                ToolbarItem(placement: submitButtonPlacement) {
                    Button {
                        Task {
                            await viewModel.createAssignee(apiClient: apiClient, eventManager: eventManager)
                            if viewModel.isComplete {
                                onComplete()
                            }
                        }
                    } label: {
                        if viewModel.isSubmitting {
                            ProgressView()
                                .frame(maxWidth: .infinity)
                        } else {
                            Text("Create Assistant")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .foregroundStyle(isSubmitButtonEnable ? Color.primaryButtonColor : Color.gray)
                    .disabled(!isSubmitButtonEnable)
                }
            }
            .overlay(alignment: .center) {
                if viewModel.isLoadingModelsAndTools {
                    VStack(spacing: 12) {
                        ProgressView()
                        Text("Loading settings")
                    }
                    .padding()
                    .glassEffect(in: .rect(cornerRadius: 24))
                }
            }
            .alert("Error", isPresented: .constant(!isPreview && viewModel.error != nil)) {
                Button("OK") { viewModel.error = nil }
            } message: {
                Text(viewModel.error ?? "")
            }
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

#Preview {
    NavigationStack {
        OnboardingView(onComplete: {})
    }
    .environment(AuthManager())
    .environment(EventManager())
}
