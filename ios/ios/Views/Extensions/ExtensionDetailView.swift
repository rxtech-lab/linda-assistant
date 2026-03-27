import AssistantCore
import MarkdownUI
import SwiftUI

struct ExtensionDetailView: View {
    let extensionId: String
    var assigneeId: String?
    var taskId: String?

    @Environment(AuthManager.self) private var authManager
    @Environment(EventManager.self) private var eventManager
    @State private var ext: ExtensionWithStatus?
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

                    // Assignee/Task-specific toggle
                    if assigneeId != nil || taskId != nil {
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
                            ForEach(Array(tools.enumerated()), id: \.element.id) { index, tool in
                                let prefixedName = "\(ext.prefix)\(tool.name)"
                                let permission = tool.effectivePermission.map {
                                    ToolPermission(toolName: prefixedName, permission: $0)
                                } ?? ext.toolPermissions?.first(where: { $0.toolName == prefixedName })
                                    ?? ToolPermission(toolName: prefixedName, permission: "manual-confirm")
                                ExtensionToolRow(
                                    tool: tool,
                                    prefix: ext.prefix,
                                    permission: permission
                                )
                                .accessibilityIdentifier("tool-row-\(index)")
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
            await loadExtension()
        }
    }

    private func loadExtension() async {
        isLoading = true
        error = nil
        do {
            if let taskId {
                ext = try await apiClient.getTaskExtension(taskId: taskId, extensionId: extensionId)
            } else if let assigneeId {
                ext = try await apiClient.getAssigneeExtension(assigneeId: assigneeId, extensionId: extensionId)
            } else {
                ext = try await apiClient.getExtension(id: extensionId)
            }
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    private func toggleEnabled(_ enabled: Bool) async {
        isToggling = true
        defer { isToggling = false }
        do {
            if let assigneeId {
                ext = try await apiClient.updateAssigneeExtension(
                    assigneeId: assigneeId,
                    extensionId: extensionId,
                    AssigneeExtensionSettings(enabled: enabled)
                )
                eventManager.emit(.assigneeExtensionUpdated(assigneeId, extensionId))
            } else if let taskId {
                ext = try await apiClient.updateTaskExtension(
                    taskId: taskId,
                    extensionId: extensionId,
                    TaskExtensionSettings(enabled: enabled)
                )
                eventManager.emit(.taskExtensionUpdated(taskId, extensionId))
            }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - Extension Tool Row

private struct ExtensionToolRow: View {
    let tool: ExtensionTool
    let prefix: String
    let permission: ToolPermission

    @State private var showingDetail = false

    private var prefixedName: String {
        "\(prefix)\(tool.name)"
    }

    private var formattedName: String {
        prefixedName
            .replacingOccurrences(of: "_", with: " ")
            .capitalized
    }

    private var iconName: String {
        switch prefixedName.lowercased() {
            case let n where n.contains("email"): "envelope"
            case let n where n.contains("search"): "magnifyingglass"
            case let n where n.contains("calendar"): "calendar"
            case let n where n.contains("file"): "doc"
            case let n where n.contains("web") || n.contains("scrape") || n.contains("crawl"): "globe"
            case let n where n.contains("message"): "message"
            case let n where n.contains("invoice"): "doc.text"
            case let n where n.contains("create") || n.contains("add"): "plus.circle"
            case let n where n.contains("list") || n.contains("get"): "list.bullet"
            case let n where n.contains("update") || n.contains("edit"): "pencil"
            case let n where n.contains("delete") || n.contains("remove"): "trash"
            default: "gearshape"
        }
    }

    private var iconColor: Color {
        switch prefixedName.lowercased() {
            case let n where n.contains("email"): .blue
            case let n where n.contains("search"): .purple
            case let n where n.contains("calendar"): .red
            case let n where n.contains("web") || n.contains("scrape") || n.contains("crawl"): .green
            case let n where n.contains("invoice"): .orange
            default: .secondary
        }
    }

    var body: some View {
        HStack {
            Image(systemName: iconName)
                .font(.body)
                .foregroundStyle(iconColor)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 2) {
                Text(formattedName)
                    .font(.body)
                if !tool.description.isEmpty {
                    if let md = try? AttributedString(markdown: tool.description) {
                        Text(md)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    } else {
                        Text(tool.description)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                }
            }
            .layoutPriority(1)

            Spacer(minLength: 4)

            PermissionBadge(
                permission: permission.permission,
                hasConditions: !(permission.conditions ?? []).isEmpty
            )
            .fixedSize()

            Image(systemName: "chevron.right")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
        .onTapGesture {
            showingDetail = true
        }
        .sheet(isPresented: $showingDetail) {
            ExtensionToolDetailSheet(
                name: formattedName,
                iconName: iconName,
                iconColor: iconColor,
                description: tool.description,
                permission: permission
            )
        }
    }
}

// MARK: - Extension Tool Detail Sheet

private struct ExtensionToolDetailSheet: View {
    let name: String
    let iconName: String
    let iconColor: Color
    let description: String
    let permission: ToolPermission

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(spacing: 12) {
                        ZStack {
                            Circle()
                                .fill(iconColor.gradient)
                                .frame(width: 64, height: 64)
                            Image(systemName: iconName)
                                .font(.title2.weight(.semibold))
                                .foregroundStyle(.white)
                        }

                        Text(name)
                            .font(.title3.weight(.semibold))

                        PermissionBadge(
                            permission: permission.permission,
                            hasConditions: !(permission.conditions ?? []).isEmpty
                        )
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .listRowBackground(Color.clear)
                }

                if !description.isEmpty {
                    Section {
                        Markdown(description)
                            .markdownTheme(.chat)
                            .textSelection(.enabled)
                    } header: {
                        Text("Description")
                    }
                }
            }
            #if os(iOS)
            .listStyle(.insetGrouped)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
