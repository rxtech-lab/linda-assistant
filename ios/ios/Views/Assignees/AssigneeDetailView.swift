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
        VStack {
            if viewModel.isLoading {
                ProgressView()
            } else if let error = viewModel.error {
                ErrorRetryView(message: error) {
                    Task { await viewModel.loadAssignee(id: assigneeId, apiClient: apiClient) }
                }
            } else if let assignee = viewModel.assignee {
                AssigneeDetailContentView(
                    assignee: assignee,
                    tools: viewModel.tools
                ) { toolName, newPermission in
                    Task {
                        await viewModel.updateToolPermission(
                            toolName: toolName,
                            newPermission: newPermission,
                            apiClient: apiClient,
                            eventManager: eventManager
                        )
                    }
                } onConditionsChange: { toolName, newConditions in
                    Task {
                        let currentPerm = assignee.toolPermissions?.first(where: { $0.toolName == toolName })?
                            .permission ?? "auto-confirm"
                        await viewModel.updateToolPermission(
                            toolName: toolName,
                            newPermission: currentPerm,
                            conditions: newConditions,
                            apiClient: apiClient,
                            eventManager: eventManager
                        )
                    }
                } onConditionLogicChange: { toolName, newLogic in
                    Task {
                        let currentPerm = assignee.toolPermissions?.first(where: { $0.toolName == toolName })?
                            .permission ?? "auto-confirm"
                        await viewModel.updateToolPermission(
                            toolName: toolName,
                            newPermission: currentPerm,
                            conditionLogic: newLogic,
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
                    Image(systemName: "ellipsis")
                }
            }
        }
        .sheet(isPresented: $showingEdit) {
            if let assignee = viewModel.assignee {
                AssigneeFormSheet(mode: .edit(assignee.id)) { updated in
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
        .task {
            await viewModel.subscribeToEvents(eventManager: eventManager, apiClient: apiClient)
        }
        .overlay(alignment: .center) {
            if viewModel.isRefreshing {
                VStack(spacing: 12) {
                    ProgressView()
                    Text("Updating")
                }
                .padding()
                .glassEffect(in: .rect(cornerRadius: 24))
            }
        }
    }
}

// MARK: - Content View (for previews)

struct AssigneeDetailContentView: View {
    let assignee: Assignee
    var tools: [AgentTool] = []
    var onPermissionChange: ((String, String) -> Void)?
    var onConditionsChange: ((String, [ToolCondition]) -> Void)?
    var onConditionLogicChange: ((String, String) -> Void)?

    private func tool(for name: String) -> AgentTool? {
        tools.first(where: { $0.name == name })
    }

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

            // Extensions section
            Section {
                NavigationLink(value: AppDestination.assigneeExtensions(assigneeId: assignee.id)) {
                    Label("Extensions", systemImage: "puzzlepiece.extension")
                }
            }

            // Tool permissions section
            if let permissions = assignee.toolPermissions, !permissions.isEmpty {
                Section {
                    ForEach(permissions, id: \.toolName) { perm in
                        ToolPermissionRow(
                            permission: perm,
                            tool: tool(for: perm.toolName)
                        ) { newPermission in
                            onPermissionChange?(perm.toolName, newPermission)
                        } onConditionsChange: { newConditions in
                            onConditionsChange?(perm.toolName, newConditions)
                        } onConditionLogicChange: { newLogic in
                            onConditionLogicChange?(perm.toolName, newLogic)
                        }
                    }
                } header: {
                    Label("System Tools", systemImage: "wrench.and.screwdriver")
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

#Preview {
    NavigationStack {
        AssigneeDetailContentView(assignee: .preview, tools: [])
            .navigationTitle("Assistant")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button("Edit", systemImage: "pencil") {}
                        Button("Delete", systemImage: "trash", role: .destructive) {}
                    } label: {
                        Image(systemName: "ellipsis")
                    }
                }
            }
    }
}
