import AssistantCore
import SwiftUI

struct AllAudiosSheet: View {
    let assigneeId: String
    var onSelectAudio: (Audio) -> Void
    var onDeleteAudio: (Audio) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(AuthManager.self) private var authManager
    @State private var viewModel = AllAudiosViewModel()
    @State private var searchText = ""
    @State private var audioToDelete: Audio?

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    var body: some View {
        NavigationStack {
            Group {
                if viewModel.isLoading, viewModel.audios.isEmpty {
                    ProgressView()
                } else if viewModel.audios.isEmpty {
                    ContentUnavailableView {
                        Label("No Audio", systemImage: "waveform")
                    } description: {
                        Text("Audio generated during chat will appear here.")
                    }
                } else {
                    List {
                        ForEach(viewModel.audios) { audio in
                            Button {
                                onSelectAudio(audio)
                                dismiss()
                            } label: {
                                HStack {
                                    Image(systemName: "waveform")
                                        .foregroundStyle(.secondary)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(audio.title)
                                            .foregroundStyle(.primary)
                                            .lineLimit(1)
                                        if let createdAt = audio.createdAt {
                                            Text(formatDateTime(createdAt))
                                                .font(.caption)
                                                .foregroundStyle(.tertiary)
                                        }
                                    }
                                    Spacer()
                                    statusPill(audio)
                                }
                            }
                            .buttonStyle(.plain)
                            #if os(iOS)
                                .swipeActions(edge: .trailing) {
                                    Button(role: .destructive) {
                                        audioToDelete = audio
                                    } label: {
                                        Label("Delete", systemImage: "trash")
                                    }
                                }
                            #endif
                                .onAppear {
                                    if audio.id == viewModel.audios.last?.id {
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
                        await viewModel.loadAudios(
                            assigneeId: assigneeId,
                            apiClient: apiClient,
                            search: searchText
                        )
                    }
                }
            }
            .searchable(text: $searchText, prompt: "Search audio")
            .onChange(of: searchText) {
                Task {
                    await viewModel.loadAudios(
                        assigneeId: assigneeId,
                        apiClient: apiClient,
                        search: searchText
                    )
                }
            }
            .navigationTitle("Audio")
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") { dismiss() }
                    }
                }
                .task {
                    await viewModel.loadAudios(assigneeId: assigneeId, apiClient: apiClient)
                }
                .confirmationDialog(
                    "Delete Audio",
                    isPresented: Binding(
                        get: { audioToDelete != nil },
                        set: { if !$0 { audioToDelete = nil } }
                    ),
                    presenting: audioToDelete
                ) { audio in
                    Button("Delete", role: .destructive) {
                        onDeleteAudio(audio)
                        viewModel.audios.removeAll { $0.id == audio.id }
                        audioToDelete = nil
                    }
                } message: { audio in
                    Text("Are you sure you want to delete \"\(audio.title)\"?")
                }
        }
    }

    @ViewBuilder
    private func statusPill(_ audio: Audio) -> some View {
        switch audio.status {
            case "ready":
                Text(audio.type.uppercased())
                    .font(.caption2)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(.fill.tertiary)
                    .clipShape(Capsule())
            case "failed":
                Text("FAILED")
                    .font(.caption2)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color.red.opacity(0.2))
                    .clipShape(Capsule())
            default:
                HStack(spacing: 4) {
                    ProgressView().controlSize(.mini)
                    Text("Generating")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
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
final class AllAudiosViewModel {
    var audios: [Audio] = []
    var isLoading = false
    var isLoadingMore = false
    var hasMore = true
    var error: String?

    private var offset = 0
    private let pageSize = 20

    func loadAudios(assigneeId: String, apiClient: APIClient, search: String = "") async {
        isLoading = true
        error = nil
        offset = 0
        do {
            let response = try await apiClient.listChatAudios(
                assigneeId: assigneeId, limit: pageSize, offset: 0,
                search: search.isEmpty ? nil : search
            )
            audios = response.data
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
            let response = try await apiClient.listChatAudios(
                assigneeId: assigneeId, limit: pageSize, offset: offset,
                search: search.isEmpty ? nil : search
            )
            audios.append(contentsOf: response.data)
            hasMore = response.pagination.hasMore
            offset += pageSize
        } catch {
            self.error = error.localizedDescription
        }
        isLoadingMore = false
    }
}
