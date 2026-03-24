import AssistantCore
import SwiftUI

struct AddExtensionSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AuthManager.self) private var authManager
    @Environment(EventManager.self) private var eventManager

    var onCreated: ((Extension) -> Void)?

    @State private var title = ""
    @State private var mcpUrl = ""
    @State private var description = ""
    @State private var authType = "rxauth"
    @State private var apiKey = ""
    @State private var isSaving = false
    @State private var error: String?

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    private var prefix: String {
        title
            .lowercased()
            .replacingOccurrences(of: " ", with: "_")
            .filter { $0.isLetter || $0.isNumber || $0 == "_" }
            + "_"
    }

    private var isValid: Bool {
        !title.trimmingCharacters(in: .whitespaces).isEmpty
            && !mcpUrl.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Title", text: $title)
                    TextField("MCP Server URL", text: $mcpUrl)
                        .urlFieldInputModifiers()
                    TextField("Description (optional)", text: $description)
                } header: {
                    Text("Extension Info")
                }

                Section {
                    Picker("Auth Type", selection: $authType) {
                        Text("RxAuth").tag("rxauth")
                        Text("API Key").tag("api_key")
                        Text("None").tag("none")
                    }

                    if authType == "api_key" {
                        SecureField("API Key", text: $apiKey)
                            .apiKeyFieldInputModifiers()
                    }
                } header: {
                    Text("Authentication")
                }

                if !title.isEmpty {
                    Section {
                        LabeledContent("Prefix", value: prefix)
                    } header: {
                        Text("Generated")
                    }
                }

                if let error {
                    Section {
                        Text(error)
                            .foregroundStyle(.red)
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Add Extension")
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Add") {
                            Task { await createExtension() }
                        }
                        .disabled(!isValid || isSaving)
                    }
                }
        }
    }

    private func createExtension() async {
        isSaving = true
        error = nil

        var authConfig: [String: AnyCodable]?
        if authType == "api_key", !apiKey.isEmpty {
            authConfig = ["apiKey": .string(apiKey)]
        }

        do {
            let created = try await apiClient.createExtension(
                CreateExtension(
                    title: title.trimmingCharacters(in: .whitespaces),
                    description: description.isEmpty ? nil : description,
                    mcpUrl: mcpUrl.trimmingCharacters(in: .whitespaces),
                    prefix: prefix,
                    authType: authType,
                    authConfig: authConfig
                )
            )
            eventManager.emit(.extensionCreated(created))
            onCreated?(created)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        isSaving = false
    }
}

private extension View {
    @ViewBuilder
    func urlFieldInputModifiers() -> some View {
        #if os(iOS)
            textInputAutocapitalization(.never)
                .keyboardType(.URL)
                .autocorrectionDisabled()
        #else
            self
        #endif
    }

    @ViewBuilder
    func apiKeyFieldInputModifiers() -> some View {
        #if os(iOS)
            textInputAutocapitalization(.never)
                .autocorrectionDisabled()
        #else
            self
        #endif
    }
}
