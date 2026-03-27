import AssistantCore
import SwiftUI

struct TaskBriefingListSheet: View {
    let taskId: String
    @Environment(\.dismiss) private var dismiss
    @Environment(AuthManager.self) private var authManager
    @State private var viewModel = TaskBriefingListViewModel()
    @State private var searchText = ""
    @State private var selectedBriefingId: String?

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    var body: some View {
        NavigationStack {
            Group {
                if viewModel.isLoading, viewModel.briefings.isEmpty {
                    ProgressView()
                } else if viewModel.briefings.isEmpty {
                    EmptyStateView(
                        icon: "newspaper",
                        title: "No Briefings",
                        message: "Briefings created during task sessions will appear here."
                    )
                } else {
                    List {
                        ForEach(viewModel.briefings) { briefing in
                            NavigationLink(value: briefing.id) {
                                HStack(spacing: 12) {
                                    if let imageUrl = briefing.imageUrl,
                                       let url = URL(string: imageUrl)
                                    {
                                        AsyncImage(url: url) { image in
                                            image
                                                .resizable()
                                                .aspectRatio(contentMode: .fill)
                                        } placeholder: {
                                            RoundedRectangle(cornerRadius: 8)
                                                .fill(.fill.tertiary)
                                        }
                                        .frame(width: 44, height: 44)
                                        .clipShape(RoundedRectangle(cornerRadius: 8))
                                    }
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(briefing.title)
                                            .font(.body)
                                        if let createdAt = briefing.createdAt {
                                            Text(formatDateTime(createdAt))
                                                .font(.caption)
                                                .foregroundStyle(.tertiary)
                                        }
                                    }
                                }
                            }
                            .onAppear {
                                if briefing.id == viewModel.briefings.last?.id {
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
                        await viewModel.loadBriefings(
                            taskId: taskId,
                            apiClient: apiClient,
                            search: searchText
                        )
                    }
                }
            }
            .searchable(text: $searchText, prompt: "Search briefings")
            .onChange(of: searchText) {
                Task {
                    await viewModel.loadBriefings(
                        taskId: taskId,
                        apiClient: apiClient,
                        search: searchText
                    )
                }
            }
            .navigationTitle("Briefings")
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
                .navigationDestination(for: String.self) { briefingId in
                    BriefingDetailView(briefingId: briefingId)
                }
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") { dismiss() }
                    }
                }
                .task {
                    await viewModel.loadBriefings(taskId: taskId, apiClient: apiClient)
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
