import AssistantCore
import SwiftUI

struct AllDocumentsSheet: View {
    let assigneeId: String
    var onSelectDocument: (Document) -> Void
    var onDeleteDocument: (Document) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(AuthManager.self) private var authManager
    @State private var viewModel = AllDocumentsViewModel()
    @State private var searchText = ""
    @State private var documentToDelete: Document?

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    var body: some View {
        NavigationStack {
            Group {
                if viewModel.isLoading, viewModel.documents.isEmpty {
                    ProgressView()
                } else if viewModel.documents.isEmpty {
                    ContentUnavailableView {
                        Label("No Documents", systemImage: "doc.text")
                    } description: {
                        Text("Documents created during chat will appear here.")
                    }
                } else {
                    List {
                        ForEach(viewModel.documents) { doc in
                            Button {
                                onSelectDocument(doc)
                                dismiss()
                            } label: {
                                HStack {
                                    Image(systemName: "doc.text")
                                        .foregroundStyle(.secondary)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(doc.title)
                                            .foregroundStyle(.primary)
                                            .lineLimit(1)
                                        if let createdAt = doc.createdAt {
                                            Text(formatDateTime(createdAt))
                                                .font(.caption)
                                                .foregroundStyle(.tertiary)
                                        }
                                    }
                                    Spacer()
                                    Text(doc.format.uppercased())
                                        .font(.caption2)
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 2)
                                        .background(.fill.tertiary)
                                        .clipShape(Capsule())
                                }
                            }
                            .buttonStyle(.plain)
                            #if os(iOS)
                                .swipeActions(edge: .trailing) {
                                    Button(role: .destructive) {
                                        documentToDelete = doc
                                    } label: {
                                        Label("Delete", systemImage: "trash")
                                    }
                                }
                            #endif
                                .onAppear {
                                    if doc.id == viewModel.documents.last?.id {
                                        Task {
                                            await viewModel.loadMore(
                                                assigneeId: assigneeId,
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
                        await viewModel.loadDocuments(
                            assigneeId: assigneeId,
                            apiClient: apiClient,
                            search: searchText
                        )
                    }
                }
            }
            .searchable(text: $searchText, prompt: "Search documents")
            .onChange(of: searchText) {
                Task {
                    await viewModel.loadDocuments(
                        assigneeId: assigneeId,
                        apiClient: apiClient,
                        search: searchText
                    )
                }
            }
            .navigationTitle("Documents")
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") { dismiss() }
                    }
                }
                .task {
                    await viewModel.loadDocuments(assigneeId: assigneeId, apiClient: apiClient)
                }
                .confirmationDialog(
                    "Delete Document",
                    isPresented: Binding(
                        get: { documentToDelete != nil },
                        set: { if !$0 { documentToDelete = nil } }
                    ),
                    presenting: documentToDelete
                ) { doc in
                    Button("Delete", role: .destructive) {
                        onDeleteDocument(doc)
                        viewModel.documents.removeAll { $0.id == doc.id }
                        documentToDelete = nil
                    }
                } message: { doc in
                    Text("Are you sure you want to delete \"\(doc.title)\"?")
                }
        }
    }

    private func formatDateTime(_ dateString: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: dateString) else {
            formatter.formatOptions = [.withInternetDateTime]
            guard let date = formatter.date(from: dateString) else { return dateString }
            return formatDate(date)
        }
        return formatDate(date)
    }

    private func formatDate(_ date: Date) -> String {
        date.formatted(.dateTime.month(.abbreviated).day().hour().minute())
    }
}

// MARK: - ViewModel

@Observable
final class AllDocumentsViewModel {
    var documents: [Document] = []
    var isLoading = false
    var isLoadingMore = false
    var hasMore = true
    var error: String?

    private var offset = 0
    private let pageSize = 20

    func loadDocuments(assigneeId: String, apiClient: APIClient, search: String = "") async {
        isLoading = true
        error = nil
        offset = 0
        do {
            let response = try await apiClient.listChatDocuments(
                assigneeId: assigneeId, limit: pageSize, offset: 0,
                search: search.isEmpty ? nil : search
            )
            documents = response.data
            hasMore = response.pagination.hasMore
            offset = pageSize
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    func loadMore(assigneeId: String, apiClient: APIClient, search: String = "") async {
        guard !isLoadingMore, hasMore else { return }
        isLoadingMore = true
        do {
            let response = try await apiClient.listChatDocuments(
                assigneeId: assigneeId, limit: pageSize, offset: offset,
                search: search.isEmpty ? nil : search
            )
            documents.append(contentsOf: response.data)
            hasMore = response.pagination.hasMore
            offset += pageSize
        } catch {
            self.error = error.localizedDescription
        }
        isLoadingMore = false
    }
}
