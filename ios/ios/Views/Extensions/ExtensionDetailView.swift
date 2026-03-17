import AssistantCore
import SwiftUI

struct ExtensionDetailView: View {
    let extensionId: String
    var assigneeId: String?

    @Environment(AuthManager.self) private var authManager
    @Environment(EventManager.self) private var eventManager
    @State private var ext: ExtensionWithStatus?
    @State private var isLoading = true
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
                    Task { await loadExtension() }
                }
            } else if let ext {
                List {
                    Section {
                        VStack(spacing: 12) {
                            Image(systemName: "puzzlepiece.extension")
                                .font(.system(size: 40))
                                .foregroundStyle(.tint)

                            Text(ext.title)
                                .font(.title2.weight(.semibold))

                            if let desc = ext.description {
                                Text(desc)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                    .multilineTextAlignment(.center)
                            }

                            HStack(spacing: 6) {
                                Image(systemName: "cpu")
                                    .font(.caption)
                                Text(ext.type == "system" ? "System" : "Custom")
                                    .font(.caption.weight(.medium))
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(.fill.tertiary)
                            .clipShape(Capsule())
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                    }
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)

                    // Assignee-specific toggle
                    if assigneeId != nil {
                        Section {
                            Toggle("Enabled", isOn: Binding(
                                get: { ext.enabled },
                                set: { newValue in
                                    Task { await toggleEnabled(newValue) }
                                }
                            ))
                        } header: {
                            Label("Status", systemImage: "power")
                        }
                    }

                    // Tools list
                    if let tools = ext.tools, !tools.isEmpty {
                        Section {
                            ForEach(tools) { tool in
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(tool.name)
                                        .font(.body.weight(.medium))
                                    Text(tool.description)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                .padding(.vertical, 2)
                            }
                        } header: {
                            Label("Tools (\(tools.count))", systemImage: "wrench.and.screwdriver")
                        }
                    }

                    // Info
                    Section {
                        LabeledContent("Prefix", value: ext.prefix)
                        LabeledContent("Auth", value: ext.authType)
                    } header: {
                        Label("Details", systemImage: "info.circle")
                    }
                }
            }
        }
        .navigationTitle(ext?.title ?? "Extension")
        .task {
            await loadExtension()
        }
    }

    private func loadExtension() async {
        isLoading = true
        error = nil
        do {
            ext = try await apiClient.getExtension(id: extensionId, assigneeId: assigneeId)
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    private func toggleEnabled(_ enabled: Bool) async {
        guard let assigneeId else { return }
        do {
            ext = try await apiClient.updateAssigneeExtension(
                assigneeId: assigneeId,
                extensionId: extensionId,
                AssigneeExtensionSettings(enabled: enabled)
            )
            eventManager.emit(.assigneeExtensionUpdated(assigneeId, extensionId))
        } catch {
            self.error = error.localizedDescription
        }
    }
}
