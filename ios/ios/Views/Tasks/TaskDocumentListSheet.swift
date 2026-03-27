import AssistantCore
import SwiftUI

struct TaskDocumentListSheet: View {
    let taskId: String
    @Environment(\.dismiss) private var dismiss
    @Environment(AuthManager.self) private var authManager
    @State private var viewModel = TaskDocumentListViewModel()
    @State private var searchText = ""
    @State private var selectedDocument: DocumentSheetItem?

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    var body: some View {
        NavigationStack {
            Group {
                if viewModel.isLoading, viewModel.documents.isEmpty {
                    ProgressView()
                } else if viewModel.documents.isEmpty {
                    EmptyStateView(
                        icon: "doc.text",
                        title: "No Documents",
                        message: "Documents created during task sessions will appear here."
                    )
                } else {
                    List {
                        ForEach(viewModel.documents) { doc in
                            Button {
                                selectedDocument = DocumentSheetItem(id: doc.id, title: doc.title)
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(doc.title)
                                            .font(.body)
                                            .foregroundStyle(.primary)
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
                            .onAppear {
                                if doc.id == viewModel.documents.last?.id {
                                    Task {
                                        await viewModel.loadMore(
                                            taskId: taskId,
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
                            taskId: taskId,
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
                        taskId: taskId,
                        apiClient: apiClient,
                        search: searchText
                    )
                }
            }
            .navigationTitle("Documents")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .sheet(item: $selectedDocument) { item in
                DocumentViewerSheet(documentId: item.id, initialTitle: item.title)
            }
            .task {
                await viewModel.loadDocuments(taskId: taskId, apiClient: apiClient)
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
        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return df.string(from: date)
    }
}
