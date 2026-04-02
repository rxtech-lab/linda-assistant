import AssistantCore
import SwiftUI

/// Horizontal paging carousel for displaying slides within documents.
/// Uses TabView with page style for swipe-based navigation.
struct SlideCarouselView: View {
    @Environment(AuthManager.self) private var authManager

    let deckId: String
    var onOpenFullViewer: ((String) -> Void)? = nil

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    @State private var deck: SlideDeck?
    @State private var isLoading = true
    @State private var currentPage: Int = 0
    @State private var showFullViewer = false

    var body: some View {
        VStack(spacing: 8) {
            if isLoading {
                RoundedRectangle(cornerRadius: 12)
                    .fill(.quaternary)
                    .aspectRatio(16 / 9, contentMode: .fit)
                    .overlay(ProgressView())
            } else if let pages = deck?.pages, !pages.isEmpty {
                TabView(selection: $currentPage) {
                    ForEach(Array(pages.enumerated()), id: \.element.id) { index, page in
                        slideImage(page)
                            .tag(index)
                    }
                }
                #if os(iOS)
                .tabViewStyle(.page(indexDisplayMode: pages.count > 1 ? .automatic : .never))
                #endif
                .aspectRatio(16 / 9, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .onTapGesture {
                    if let onOpenFullViewer {
                        onOpenFullViewer(deckId)
                    } else {
                        showFullViewer = true
                    }
                }

                // Title and slide count
                HStack {
                    if let title = deck?.title {
                        Text(title)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text("\(currentPage + 1) / \(pages.count)")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                .padding(.horizontal, 4)
            } else {
                RoundedRectangle(cornerRadius: 12)
                    .fill(.quaternary)
                    .aspectRatio(16 / 9, contentMode: .fit)
                    .overlay {
                        Text("No slides")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
            }
        }
        .modifier(SelfPresentingSlideViewer(deckId: deckId, isPresented: $showFullViewer, isEnabled: onOpenFullViewer == nil))
        .frame(maxWidth: .infinity)
        .task {
            await loadDeck()
        }
    }

    @ViewBuilder
    private func slideImage(_ page: SlidePage) -> some View {
        let urlStr = page.imageUrl
        if let urlStr, let url = URL(string: urlStr) {
            CachedAsyncImage(url: url) { image in
                image
                    .resizable()
                    .aspectRatio(contentMode: .fit)
            } placeholder: {
                Rectangle()
                    .fill(.quaternary)
                    .overlay(ProgressView())
            }
        } else {
            Rectangle()
                .fill(.quaternary)
                .overlay {
                    Image(systemName: "photo")
                        .foregroundStyle(.secondary)
                }
        }
    }

    private func loadDeck() async {
        isLoading = true
        do {
            deck = try await apiClient.getSlideDeck(id: deckId)
        } catch {
            print("[SlideCarouselView] Failed to load deck: \(error)")
        }
        isLoading = false
    }
}

private struct SelfPresentingSlideViewer: ViewModifier {
    let deckId: String
    @Binding var isPresented: Bool
    let isEnabled: Bool

    func body(content: Content) -> some View {
        if isEnabled {
            #if os(iOS)
            content.fullScreenCover(isPresented: $isPresented) {
                SlideViewerSheet(deckId: deckId)
            }
            #else
            content.sheet(isPresented: $isPresented) {
                SlideViewerSheet(deckId: deckId)
            }
            #endif
        } else {
            content
        }
    }
}
