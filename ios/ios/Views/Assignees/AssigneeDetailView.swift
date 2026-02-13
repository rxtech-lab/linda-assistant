import AssistantCore
import SwiftUI

struct AssigneeDetailView: View {
    let assigneeId: String
    let assigneeName: String
    @Environment(AuthManager.self) private var authManager
    @Environment(EventManager.self) private var eventManager
    @State private var viewModel = AssigneeDetailViewModel()
    @State private var showingEdit = false
    @State private var showingDelete = false

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    var body: some View {
        Group {
            if viewModel.isLoading {
                ProgressView()
            } else if let error = viewModel.error {
                ErrorRetryView(message: error) {
                    Task { await viewModel.loadAssignee(id: assigneeId, apiClient: apiClient) }
                }
            } else if let assignee = viewModel.assignee {
                AssigneeDetailContentView(assignee: assignee) { toolName, newPermission in
                    Task {
                        await viewModel.updateToolPermission(
                            toolName: toolName,
                            newPermission: newPermission,
                            apiClient: apiClient,
                            eventManager: eventManager
                        )
                    }
                }
            }
        }
        .navigationTitle(viewModel.assignee?.name ?? assigneeName)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button("Edit", systemImage: "pencil") { showingEdit = true }
                    Button("Delete", systemImage: "trash", role: .destructive) { showingDelete = true }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .sheet(isPresented: $showingEdit) {
            if let assignee = viewModel.assignee {
                AssigneeFormSheet(mode: .edit(assignee)) { updated in
                    eventManager.emit(.assigneeUpdated(updated))
                }
            }
        }
        .sheet(isPresented: $showingDelete) {
            DeleteConfirmationSheet(
                title: "Delete Assistant?",
                message: "\"\(viewModel.assignee?.name ?? "")\" will be permanently deleted."
            ) {
                Task {
                    await viewModel.deleteAssignee(apiClient: apiClient, eventManager: eventManager)
                }
            }
        }
        .task {
            await viewModel.loadAssignee(id: assigneeId, apiClient: apiClient)
        }
    }
}

// MARK: - Content View (for previews)

struct AssigneeDetailContentView: View {
    let assignee: Assignee
    var onPermissionChange: ((String, String) -> Void)?

    var body: some View {
        List {
            // Header card section
            Section {
                AssigneeHeaderCard(assignee: assignee)
            }
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)

            // Personality section
            if let personality = assignee.personality, !personality.isEmpty {
                Section {
                    Text(personality)
                        .font(.body)
                        .foregroundStyle(.secondary)
                } header: {
                    Label("Personality", systemImage: "sparkles")
                }
            }

            // Tool permissions section
            if let permissions = assignee.toolPermissions, !permissions.isEmpty {
                Section {
                    ForEach(permissions, id: \.toolName) { perm in
                        ToolPermissionRow(permission: perm) { newPermission in
                            onPermissionChange?(perm.toolName, newPermission)
                        }
                    }
                } header: {
                    Label("Tool Permissions", systemImage: "wrench.and.screwdriver")
                }
            }
        }
    }
}

// MARK: - Header Card

private struct AssigneeHeaderCard: View {
    let assignee: Assignee

    var body: some View {
        VStack(spacing: 16) {
            // Avatar
            ZStack {
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [.orange, .pink],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 80, height: 80)

                Text(assignee.name.prefix(1).uppercased())
                    .font(.system(size: 32, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
            }

            // Name and email
            VStack(spacing: 4) {
                Text(assignee.name)
                    .font(.title2.weight(.semibold))

                Text(assignee.email)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            // Model badge
            if let model = assignee.model {
                HStack(spacing: 6) {
                    Image(systemName: "cpu")
                        .font(.caption)
                    Text(model)
                        .font(.caption.weight(.medium))
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(.fill.tertiary)
                .clipShape(Capsule())
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
    }
}

// MARK: - Tool Permission Row

private struct ToolPermissionRow: View {
    let permission: ToolPermission
    var onPermissionChange: ((String) -> Void)?

    @State private var selectedPermission: String

    private static let permissionOptions: [(value: String, label: String)] = [
        ("auto-confirm", "Auto"),
        ("manual-confirm", "Confirm"),
        ("auto-reject", "Reject"),
    ]

    init(permission: ToolPermission, onPermissionChange: ((String) -> Void)? = nil) {
        self.permission = permission
        self.onPermissionChange = onPermissionChange
        _selectedPermission = State(initialValue: permission.permission)
    }

    var body: some View {
        HStack {
            Image(systemName: iconName)
                .font(.body)
                .foregroundStyle(iconColor)
                .frame(width: 28)

            Text(formattedToolName)
                .font(.body)

            Spacer()

            Menu {
                ForEach(Self.permissionOptions, id: \.value) { option in
                    Button {
                        selectedPermission = option.value
                        onPermissionChange?(option.value)
                    } label: {
                        HStack {
                            Text(option.label)
                            if option.value == selectedPermission {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                }
            } label: {
                PermissionBadge(permission: selectedPermission)
            }
        }
        .padding(.vertical, 2)
    }

    private var formattedToolName: String {
        permission.toolName
            .replacingOccurrences(of: "_", with: " ")
            .capitalized
    }

    private var iconName: String {
        switch permission.toolName.lowercased() {
            case let name where name.contains("email"): "envelope"
            case let name where name.contains("search"): "magnifyingglass"
            case let name where name.contains("calendar"): "calendar"
            case let name where name.contains("file"): "doc"
            case let name where name.contains("web"): "globe"
            case let name where name.contains("message"): "message"
            default: "gearshape"
        }
    }

    private var iconColor: Color {
        switch permission.toolName.lowercased() {
            case let name where name.contains("email"): .blue
            case let name where name.contains("search"): .purple
            case let name where name.contains("calendar"): .red
            case let name where name.contains("web"): .green
            default: .secondary
        }
    }
}

// MARK: - Permission Badge

private struct PermissionBadge: View {
    let permission: String

    var body: some View {
        Text(displayText)
            .font(.caption2.weight(.medium))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(color.opacity(0.15))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }

    private var displayText: String {
        switch permission.lowercased() {
            case "auto-confirm": "Auto"
            case "manual-confirm": "Confirm"
            case "auto-reject": "Reject"
            default: permission.capitalized
        }
    }

    private var color: Color {
        switch permission.lowercased() {
            case "auto-confirm", "auto": .green
            case "manual-confirm", "confirm": .orange
            case "auto-reject", "deny", "denied": .red
            default: .secondary
        }
    }
}

#Preview {
    NavigationStack {
        AssigneeDetailContentView(assignee: .preview)
            .navigationTitle("Assistant")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button("Edit", systemImage: "pencil") {}
                        Button("Delete", systemImage: "trash", role: .destructive) {}
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
    }
}
