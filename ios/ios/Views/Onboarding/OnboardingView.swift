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
                        ForEach(viewModel.availableModels, id: \.self) { model in
                            Text(model).tag(model)
                        }
                    }
                }
            }

            if !viewModel.availableTools.isEmpty {
                Section("Tool Permissions") {
                    ForEach(viewModel.availableTools) { tool in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(tool.name)
                                    .font(.body)
                                if let markdown = try? AttributedString(markdown: tool.description) {
                                    Text(markdown)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                } else {
                                    Text(tool.description)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            Picker("", selection: viewModel.bindingForTool(tool.name)) {
                                Text("Auto").tag("auto-confirm")
                                Text("Manual").tag("manual-confirm")
                                Text("Reject").tag("auto-reject")
                                Text("Disabled").tag("disabled")
                            }
                            .labelsHidden()
                        }
                    }
                }
            }
        }
        .navigationTitle("Welcome to Linda")
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
