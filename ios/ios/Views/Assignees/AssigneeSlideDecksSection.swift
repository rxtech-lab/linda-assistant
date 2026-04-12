import AssistantCore
import Kingfisher
import SwiftUI

/// Inline section for AssigneeDetailView that lists the assignee's slide decks.
struct AssigneeSlideDecksSection: View {
    let assigneeId: String

    @Environment(AuthManager.self) private var authManager
    @State private var slideDecks: [SlideDeckListItem] = []
    @State private var totalCount = 0
    @State private var isLoading = true
    @State private var selectedDeckId: String?
    @State private var showingAllSlides = false

    private let maxPreviewCount = 6

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    private var previewDecks: [SlideDeckListItem] {
        Array(slideDecks.prefix(maxPreviewCount))
    }

    var body: some View {
        if isLoading {
            Section {
                HStack {
                    Spacer()
                    ProgressView()
                    Spacer()
                }
            } header: {
                Label("Slides", systemImage: "rectangle.on.rectangle")
            }
            .task {
                await loadSlideDecks()
            }
        } else if !slideDecks.isEmpty {
                slideDecksSection
                    .slideViewerPresenter(deckId: $selectedDeckId)
                    .sheet(isPresented: $showingAllSlides) {
                        AllSlideDecksSheet(assigneeId: assigneeId)
                    }
        }
    }

    private var slideDecksSection: some View {
        Section {
            ForEach(previewDecks) { deck in
                Button {
                    selectedDeckId = deck.id
                } label: {
                    HStack(spacing: 12) {
                        // Thumbnail
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
                .buttonStyle(.plain)
            }
        } header: {
            Button {
                showingAllSlides = true
            } label: {
                HStack {
                    Label("Slides", systemImage: "rectangle.on.rectangle")
                    if totalCount > 0 {
                        Text("\(totalCount)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
            .foregroundStyle(.primary)
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

    private func loadSlideDecks() async {
        do {
            let response = try await apiClient.listChatSlideDecks(
                assigneeId: assigneeId,
                limit: maxPreviewCount
            )
            slideDecks = response.data
            totalCount = response.pagination.total
        } catch {
            print("[AssigneeSlideDecksSection] Failed to load: \(error)")
        }
        isLoading = false
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
