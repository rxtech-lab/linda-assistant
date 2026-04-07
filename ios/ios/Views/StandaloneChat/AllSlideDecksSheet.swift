import AssistantCore
import Kingfisher
import SwiftUI

struct AllSlideDecksSheet: View {
    let assigneeId: String

    @Environment(\.dismiss) private var dismiss
    @Environment(AuthManager.self) private var authManager
    @State private var viewModel = AllSlideDecksViewModel()
    @State private var searchText = ""
    @State private var selectedDeckId: String?

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    var body: some View {
        NavigationStack {
            Group {
                if viewModel.isLoading, viewModel.slideDecks.isEmpty {
                    ProgressView()
                } else if viewModel.slideDecks.isEmpty {
                    ContentUnavailableView {
                        Label("No Slides", systemImage: "rectangle.on.rectangle")
                    } description: {
                        Text("Slide decks created during chat will appear here.")
                    }
                } else {
                    List {
                        ForEach(viewModel.slideDecks) { deck in
                            Button {
                                selectedDeckId = deck.id
                            } label: {
                                slideDeckRow(deck)
                            }
                            .buttonStyle(.plain)
                            .onAppear {
                                if deck.id == viewModel.slideDecks.last?.id {
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
                        await viewModel.loadSlideDecks(
                            assigneeId: assigneeId,
                            apiClient: apiClient,
                            search: searchText
                        )
                    }
                }
            }
            .searchable(text: $searchText, prompt: "Search slides")
            .onChange(of: searchText) {
                Task {
                    await viewModel.loadSlideDecks(
                        assigneeId: assigneeId,
                        apiClient: apiClient,
                        search: searchText
                    )
                }
            }
            .navigationTitle("Slides")
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") { dismiss() }
                    }
                }
                .task {
                    await viewModel.loadSlideDecks(assigneeId: assigneeId, apiClient: apiClient)
                }
            #if os(macOS)
                .sheet(isPresented: selectedDeckBinding) {
                    if let deckId = selectedDeckId {
                        SlideViewerSheet(deckId: deckId)
                    }
                }
            #else
                .fullScreenCover(isPresented: selectedDeckBinding) {
                        if let deckId = selectedDeckId {
                            SlideViewerSheet(deckId: deckId)
                        }
                    }
            #endif
        }
    }

    private var selectedDeckBinding: Binding<Bool> {
        Binding(
            get: { selectedDeckId != nil },
            set: { if !$0 { selectedDeckId = nil } }
        )
    }

    private func slideDeckRow(_ deck: SlideDeckListItem) -> some View {
        HStack(spacing: 12) {
            if let urlStr = deck.thumbnailUrl, let url = URL(string: urlStr) {
                KFImage(url)
                    .placeholder {
                        Rectangle()
                            .fill(.quaternary)
                            .overlay(ProgressView().controlSize(.small))
                    }
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .frame(width: 64, height: 36)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            } else {
                slidePlaceholder
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(deck.title)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                HStack(spacing: 4) {
                    Text("\(deck.pageCount) \(deck.pageCount == 1 ? "slide" : "slides")")
                    if let createdAt = deck.createdAt {
                        Text("·")
                        Text(formatDateTime(createdAt))
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
    }

    private var slidePlaceholder: some View {
        RoundedRectangle(cornerRadius: 6)
            .fill(.quaternary)
            .frame(width: 64, height: 36)
            .overlay {
                Image(systemName: "rectangle.on.rectangle")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
    }

    private func formatDateTime(_ dateString: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: dateString) else {
            formatter.formatOptions = [.withInternetDateTime]
            guard let date = formatter.date(from: dateString) else { return dateString }
            return date.formatted(.dateTime.month(.abbreviated).day())
        }
        return date.formatted(.dateTime.month(.abbreviated).day())
    }
}

// MARK: - ViewModel

@Observable
final class AllSlideDecksViewModel {
    var slideDecks: [SlideDeckListItem] = []
    var isLoading = false
    var isLoadingMore = false
    var hasMore = true
    var error: String?

    private var offset = 0
    private let pageSize = 20

    func loadSlideDecks(assigneeId: String, apiClient: APIClient, search: String = "") async {
        isLoading = true
        error = nil
        offset = 0
        do {
            let response = try await apiClient.listChatSlideDecks(
                assigneeId: assigneeId, limit: pageSize, offset: 0,
                search: search.isEmpty ? nil : search
            )
            slideDecks = response.data
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
            let response = try await apiClient.listChatSlideDecks(
                assigneeId: assigneeId, limit: pageSize, offset: offset,
                search: search.isEmpty ? nil : search
            )
            slideDecks.append(contentsOf: response.data)
            hasMore = response.pagination.hasMore
            offset += pageSize
        } catch {
            self.error = error.localizedDescription
        }
        isLoadingMore = false
    }
}
