import SwiftUI
import AssistantCore

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
                List {
                    Section("Info") {
                        LabeledContent("Email", value: assignee.email)
                        if let model = assignee.model {
                            LabeledContent("Model", value: model)
                        }
                    }

                    if let personality = assignee.personality, !personality.isEmpty {
                        Section("Personality") {
                            Text(personality)
                        }
                    }

                    if let permissions = assignee.toolPermissions, !permissions.isEmpty {
                        Section("Tool Permissions") {
                            ForEach(permissions, id: \.toolName) { perm in
                                LabeledContent(perm.toolName, value: perm.permission)
                            }
                        }
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
