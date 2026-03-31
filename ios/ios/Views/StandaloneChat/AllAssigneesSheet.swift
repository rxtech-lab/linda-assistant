import AssistantCore
import SwiftUI

struct AllAssigneesSheet: View {
    let selectedAssigneeId: String?
    var onSelectAssignee: (Assignee) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(AuthManager.self) private var authManager
    @State private var viewModel = AllAssigneesViewModel()
    @State private var searchText = ""

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    var body: some View {
        NavigationStack {
            Group {
                if viewModel.isLoading, viewModel.assignees.isEmpty {
                    ProgressView()
                } else if viewModel.assignees.isEmpty {
                    ContentUnavailableView {
                        Label("No Assistants", systemImage: "person.2.slash")
                    } description: {
                        Text("No assistants found.")
                    }
                } else {
                    List {
                        ForEach(viewModel.assignees, id: \.id) { assignee in
                            Button {
                                onSelectAssignee(assignee)
                                dismiss()
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(assignee.name)
                                            .foregroundStyle(.primary)
                                        Text(assignee.email)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    if assignee.id == selectedAssigneeId {
                                        Image(systemName: "checkmark")
                                            .foregroundStyle(.tint)
                                    }
                                }
                            }
                            .onAppear {
                                if assignee.id == viewModel.assignees.last?.id {
                                    Task {
                                        await viewModel.loadMore(
                                            apiClient: apiClient,
                                            search: searchText
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
                    .refreshable {
                        await viewModel.loadAssignees(apiClient: apiClient, search: searchText)
                    }
                }
            }
            .searchable(text: $searchText, prompt: "Search assistants")
            .onChange(of: searchText) {
                Task {
                    await viewModel.loadAssignees(apiClient: apiClient, search: searchText)
                }
            }
            .navigationTitle("Assistants")
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") { dismiss() }
                    }
                }
                .task {
                    await viewModel.loadAssignees(apiClient: apiClient)
                }
        }
    }
}

// MARK: - ViewModel

@Observable
final class AllAssigneesViewModel {
    var assignees: [Assignee] = []
    var isLoading = false
    var isLoadingMore = false
    var hasMore = true
    var error: String?

    private var offset = 0
    private let pageSize = 20

    func loadAssignees(apiClient: APIClient, search: String = "") async {
        isLoading = true
        error = nil
        offset = 0
        do {
            let response = try await apiClient.listAssignees(
                limit: pageSize, offset: 0, search: search.isEmpty ? nil : search
            )
            assignees = response.data
            hasMore = response.pagination.hasMore
            offset = pageSize
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    func loadMore(apiClient: APIClient, search: String = "") async {
        guard !isLoadingMore, hasMore else { return }
        isLoadingMore = true
        do {
            let response = try await apiClient.listAssignees(
                limit: pageSize, offset: offset, search: search.isEmpty ? nil : search
            )
            assignees.append(contentsOf: response.data)
            hasMore = response.pagination.hasMore
            offset += pageSize
        } catch {
            self.error = error.localizedDescription
        }
        isLoadingMore = false
    }
}
