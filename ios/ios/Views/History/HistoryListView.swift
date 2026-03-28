import AssistantCore
import SwiftUI

struct HistoryListView: View {
    let assigneeId: String?

    @State private var viewModel = HistoryListViewModel()
    @State private var searchText = ""
    @State private var showingFilter = false
    @State private var selectedAssigneeId: String?
    @State private var assignees: [Assignee] = []
    @Environment(AuthManager.self) private var authManager

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    /// The effective assignee filter — prop takes priority, then user selection
    private var effectiveAssigneeId: String? {
        assigneeId ?? selectedAssigneeId
    }

    init(assigneeId: String? = nil) {
        self.assigneeId = assigneeId
    }

    var body: some View {
        Group {
            if viewModel.isLoading, viewModel.items.isEmpty {
                ProgressView()
            } else if let error = viewModel.error, viewModel.items.isEmpty {
                ContentUnavailableView {
                    Label("Error", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(error)
                } actions: {
                    Button("Retry") {
                        Task { await reload() }
                    }
                }
            } else if viewModel.items.isEmpty {
                ContentUnavailableView {
                    Label("No History", systemImage: "clock.arrow.circlepath")
                } description: {
                    Text("Task execution history will appear here after tasks complete.")
                }
            } else {
                List {
                    ForEach(viewModel.items) { item in
                        NavigationLink(value: AppDestination.historyDetail(item)) {
                            HistoryRowView(item: item, viewModel: viewModel)
                        }
                        .buttonStyle(.plain)
                        .onAppear {
                            if item.id == viewModel.items.last?.id {
                                Task {
                                    await viewModel.loadMore(
                                        assigneeId: effectiveAssigneeId,
                                        search: searchText.isEmpty ? nil : searchText,
                                        apiClient: apiClient
                                    )
                                }
                            }
                        }
                    }

                    if viewModel.isLoadingMore {
                        HStack {
                            Spacer()
                            ProgressView()
                            Spacer()
                        }
                    }
                }
            }
        }
        .navigationTitle("History")
        .searchable(text: $searchText, prompt: "Search history")
        #if os(iOS)
            .toolbar(.hidden, for: .tabBar)
        #endif
            .onChange(of: searchText) { _, newValue in
                Task {
                    try? await Task.sleep(for: .milliseconds(300))
                    await viewModel.loadHistory(
                        assigneeId: effectiveAssigneeId,
                        search: newValue.isEmpty ? nil : newValue,
                        apiClient: apiClient
                    )
                }
            }
            .refreshable {
                await reload()
            }
            .task {
                async let loadAssignees: () = loadAssigneeList()
                async let loadHistory: () = reload()
                _ = await (loadAssignees, loadHistory)
            }
            .toolbar {
                // Only show filter when not already scoped to a specific assignee
                if assigneeId == nil {
                    ToolbarItem(placement: .primaryAction) {
                        Button {
                            showingFilter = true
                        } label: {
                            Image(systemName: selectedAssigneeId != nil ? "line.3.horizontal.decrease.circle.fill" :
                                "line.3.horizontal.decrease.circle")
                        }
                    }
                }
            }
            .sheet(isPresented: $showingFilter) {
                AssigneeFilterSheet(
                    assignees: assignees,
                    selectedAssigneeId: $selectedAssigneeId
                )
                .presentationDetents([.medium])
            }
            .onChange(of: selectedAssigneeId) { _, _ in
                Task { await reload() }
            }
    }

    private func reload() async {
        await viewModel.loadHistory(
            assigneeId: effectiveAssigneeId,
            search: searchText.isEmpty ? nil : searchText,
            apiClient: apiClient
        )
    }

    private func loadAssigneeList() async {
        do {
            let response = try await apiClient.listAssignees(limit: 100)
            assignees = response.data
        } catch {
            // Non-critical — filter just won't be available
        }
    }
}

// MARK: - Assignee Filter Sheet

private struct AssigneeFilterSheet: View {
    let assignees: [Assignee]
    @Binding var selectedAssigneeId: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Button {
                    selectedAssigneeId = nil
                    dismiss()
                } label: {
                    HStack {
                        Label("All Assistants", systemImage: "person.2")
                        Spacer()
                        if selectedAssigneeId == nil {
                            Image(systemName: "checkmark")
                                .foregroundStyle(.tint)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                ForEach(assignees) { assignee in
                    Button {
                        selectedAssigneeId = assignee.id
                        dismiss()
                    } label: {
                        HStack {
                            Label(assignee.name, systemImage: "person")
                            Spacer()
                            if selectedAssigneeId == assignee.id {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(.tint)
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .navigationTitle("Filter by Assistant")
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
        }
    }
}

// MARK: - History Row

private struct HistoryRowView: View {
    let item: TaskHistory
    let viewModel: HistoryListViewModel

    private var markdownSummary: AttributedString {
        (try? AttributedString(markdown: item.summary)) ?? AttributedString(item.summary)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .center, spacing: 8) {
                if let title = item.taskTitle {
                    Text(title)
                        .font(.headline)
                        .lineLimit(1)
                }

                Spacer()

                if let status = item.status {
                    Image(systemName: statusIcon(status))
                        .font(.caption)
                        .foregroundStyle(statusColor(status))
                }
            }

            Text(markdownSummary)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(3)

            HStack(spacing: 6) {
                if let source = item.source {
                    Text(source.capitalized)
                        .font(.caption2)
                        .fontWeight(.medium)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(sourceColor(source).opacity(0.15), in: Capsule())
                        .foregroundStyle(sourceColor(source))
                }

                if let toolCalls = item.toolCalls, !toolCalls.isEmpty {
                    Label("\(toolCalls.count)", systemImage: "wrench.and.screwdriver")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if let duration = viewModel.formatDuration(item.durationSecs) {
                    Label(duration, systemImage: "clock")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Text(viewModel.formatDate(item.createdAt))
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 4)
    }

    private func statusIcon(_ status: String) -> String {
        switch status.lowercased() {
            case "completed", "stopped": "checkmark.circle.fill"
            case "failed", "error": "xmark.circle.fill"
            case "running", "active": "play.circle.fill"
            case "pending": "clock.fill"
            default: "circle.fill"
        }
    }

    private func statusColor(_ status: String) -> Color {
        switch status.lowercased() {
            case "completed", "stopped": .green
            case "failed", "error": .red
            case "running", "active": .blue
            case "pending": .orange
            default: .gray
        }
    }

    private func sourceColor(_ source: String) -> Color {
        switch source.lowercased() {
            case "email": .blue
            case "webhook": .orange
            default: .green
        }
    }
}
