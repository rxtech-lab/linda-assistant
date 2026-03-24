import AssistantCore
import SwiftUI

struct TaskExtensionListView: View {
    let taskId: String

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
                    ForEach(extensions) { ext in
                        NavigationLink(value: AppDestination.extensionDetail(
                            extensionId: ext.id,
                            assigneeId: nil,
                            taskId: taskId
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
                            }
                        }
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
                    case let .taskExtensionUpdated(tId, _) where tId == taskId:
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
            extensions = try await apiClient.listTaskExtensions(taskId: taskId)
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    private func toggleExtension(_ ext: ExtensionWithStatus, enabled: Bool) async {
        isToggling = true
        defer { isToggling = false }
        do {
            let updated = try await apiClient.updateTaskExtension(
                taskId: taskId,
                extensionId: ext.id,
                TaskExtensionSettings(enabled: enabled)
            )
            if let index = extensions.firstIndex(where: { $0.id == ext.id }) {
                extensions[index] = updated
            }
            eventManager.emit(.taskExtensionUpdated(taskId, ext.id))
        } catch {
            self.error = error.localizedDescription
        }
    }
}
