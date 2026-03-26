import AssistantCore
import SwiftUI

struct AssigneeExtensionListView: View {
    let assigneeId: String

    @Environment(AuthManager.self) private var authManager
    @Environment(EventManager.self) private var eventManager
    @State private var extensions: [ExtensionWithStatus] = []
    @State private var isLoading = true
    @State private var isToggling = false
    @State private var error: String?

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
            } else if let error {
                ErrorRetryView(message: error) {
                    Task { await loadExtensions() }
                }
            } else if extensions.isEmpty {
                ContentUnavailableView(
                    "No Extensions",
                    systemImage: "puzzlepiece.extension",
                    description: Text("Add extensions in Settings to get started.")
                )
            } else {
                List {
                    ForEach(Array(extensions.enumerated()), id: \.element.id) { index, ext in
                        NavigationLink(value: AppDestination.extensionDetail(
                            extensionId: ext.id,
                            assigneeId: assigneeId
                        )) {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(ext.title)
                                        .font(.body)
                                    if let desc = ext.description {
                                        Text(desc)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                            .lineLimit(1)
                                    }
                                }

                                Spacer()

                                Toggle("", isOn: Binding(
                                    get: { ext.enabled },
                                    set: { newValue in
                                        Task { await toggleExtension(ext, enabled: newValue) }
                                    }
                                ))
                                .labelsHidden()
                                .accessibilityIdentifier("extension-toggle-\(index)")
                            }
                        }
                        .accessibilityIdentifier("extension-row-\(index)")
                    }
                }
            }
        }
        .navigationTitle("Extensions")
        .overlay(alignment: .center) {
            if isToggling {
                VStack(spacing: 12) {
                    ProgressView()
                    Text("Updating")
                }
                .padding()
                .glassEffect(in: .rect(cornerRadius: 24))
            }
        }
        .task {
            await loadExtensions()
        }
        .task {
            for await event in eventManager.stream {
                switch event {
                    case let .assigneeExtensionUpdated(aId, _) where aId == assigneeId:
                        await loadExtensions()
                    case .extensionCreated, .extensionDeleted:
                        await loadExtensions()
                    default:
                        break
                }
            }
        }
    }

    private func loadExtensions() async {
        isLoading = extensions.isEmpty
        error = nil
        do {
            extensions = try await apiClient.listAssigneeExtensions(assigneeId: assigneeId)
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    private func toggleExtension(_ ext: ExtensionWithStatus, enabled: Bool) async {
        isToggling = true
        defer { isToggling = false }
        do {
            let updated = try await apiClient.updateAssigneeExtension(
                assigneeId: assigneeId,
                extensionId: ext.id,
                AssigneeExtensionSettings(enabled: enabled)
            )
            if let index = extensions.firstIndex(where: { $0.id == ext.id }) {
                extensions[index] = updated
            }
            eventManager.emit(.assigneeExtensionUpdated(assigneeId, ext.id))
        } catch {
            self.error = error.localizedDescription
        }
    }
}
