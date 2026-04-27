import AssistantCore
import Kingfisher
import MarkdownUI
import SwiftUI

struct BriefingDetailView: View {
    @Environment(AuthManager.self) private var authManager
    @Environment(EventManager.self) private var eventManager
    @Environment(\.dismiss) private var dismiss
    let briefingId: String

    @State private var briefing: Briefing?
    @State private var isLoading = true
    @State private var error: String?
    @State private var showingDelete = false
    @State private var selectedDocument: DocumentSheetItem?
    @State private var shareItem: ShareURLItem?
    @State private var isMutatingShare = false
    @State private var isGeneratingPodcast = false
    @State private var podcastToastMessage: String?

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
            } else if let error {
                ErrorRetryView(message: error) {
                    Task { await loadBriefing() }
                }
            } else if let briefing {
                let columnWidth = currentMaxContentWidth()
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        // Cover image
                        coverImage(for: briefing)

                        VStack(alignment: .leading, spacing: 12) {
                            // Podcast player
                            if let urlStr = briefing.podcastUrl, let url = URL(string: urlStr) {
                                PodcastPlayerView(
                                    url: url,
                                    title: briefing.title,
                                    imageUrl: briefing.imageUrl
                                )
                                .accessibilityIdentifier("podcast-player")
                            }

                            if let date = briefing.createdAt {
                                Text(formatDate(date))
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }

                            SlideAwareMarkdownView(content: briefing.content)
                                .tappableMarkdownImages()
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .clipped()

                            // Linked documents
                            if let documents = briefing.documents, !documents.isEmpty {
                                Divider()
                                    .padding(.vertical, 8)

                                Text("Linked Documents")
                                    .font(.headline)

                                ForEach(documents) { doc in
                                    HStack {
                                        Image(systemName: "doc.text")
                                            .foregroundStyle(.blue)
                                        Text(doc.title)
                                        Spacer()
                                        Image(systemName: "chevron.right")
                                            .foregroundStyle(.tertiary)
                                    }
                                    .padding(.vertical, 4)
                                    .contentShape(Rectangle())
                                    .onTapGesture {
                                        selectedDocument = DocumentSheetItem(id: doc.id, title: doc.title)
                                    }
                                    .accessibilityIdentifier("linked-doc-\(doc.id)")
                                }
                            }
                        }
                        .padding()
                        .frame(maxWidth: columnWidth, alignment: .leading)
                        .clipped()
                    }
                    .frame(maxWidth: columnWidth, alignment: .leading)
                }
                .ignoresSafeArea(edges: .top)
                .scrollBounceBehavior(.basedOnSize)
            }
        }
        #if os(iOS)
        .toolbarVisibility(.hidden, for: .tabBar)
        #endif
        .navigationTitle(briefing?.title ?? "Briefing")
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackgroundVisibility(.automatic, for: .navigationBar)
        #endif
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button {
                            Task { await share() }
                        } label: {
                            Label("Share", systemImage: "square.and.arrow.up")
                        }
                        .accessibilityIdentifier("share-briefing")
                        .disabled(isMutatingShare)

                        if briefing?.isPublic == true {
                            Button {
                                Task { await setPublic(false) }
                            } label: {
                                Label("Make Private", systemImage: "lock")
                            }
                            .accessibilityIdentifier("make-private-briefing")
                            .disabled(isMutatingShare)
                        }

                        if let briefing, briefing.podcastUrl == nil {
                            Button {
                                Task { await generatePodcast() }
                            } label: {
                                Label(
                                    isGeneratingPodcast ? "Generating Podcast…" : "Generate Podcast",
                                    systemImage: "waveform"
                                )
                            }
                            .accessibilityIdentifier("generate-podcast")
                            .disabled(isGeneratingPodcast)
                        }

                        Button(role: .destructive) {
                            showingDelete = true
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    } label: {
                        Image(systemName: "ellipsis")
                    }
                    .accessibilityIdentifier("briefing-menu")
                }
            }
            .alert(
                "Podcast",
                isPresented: Binding(
                    get: { podcastToastMessage != nil },
                    set: { if !$0 { podcastToastMessage = nil } }
                ),
                presenting: podcastToastMessage
            ) { _ in
                Button("OK", role: .cancel) { podcastToastMessage = nil }
            } message: { message in
                Text(message)
            }
            .sheet(isPresented: $showingDelete) {
                DeleteConfirmationSheet(
                    title: "Delete Briefing",
                    message: "Are you sure you want to delete this briefing? This action cannot be undone."
                ) {
                    Task {
                        await deleteBriefing()
                    }
                }
            }
            .sheet(item: $selectedDocument) { doc in
                DocumentViewerSheet(documentId: doc.id, initialTitle: doc.title)
            }
        #if os(iOS)
            .sheet(item: $shareItem) { item in
                ShareActivityView(url: item.url)
                    .presentationDetents([.medium, .large])
            }
        #endif
            .task {
                await loadBriefing()
            }
            .task(id: briefingId) {
                for await event in eventManager.stream {
                    if case let .briefingPodcastReady(id, _) = event, id == briefingId {
                        await loadBriefing()
                    }
                }
            }
    }

    @ViewBuilder
    private func coverImage(for briefing: Briefing) -> some View {
        if let imageUrl = briefing.imageUrl, let url = URL(string: imageUrl) {
            KFImage(url)
                .placeholder {
                    placeholderGradient
                        .transition(.opacity)
                }
                .resizable()
                .aspectRatio(contentMode: .fill)
                .frame(maxWidth: .infinity, minHeight: 400)
                .frame(height: 400)
                .clipped()
                .transition(.opacity)
        } else {
            placeholderGradient
        }
    }

    private var placeholderGradient: some View {
        LinearGradient(
            colors: [.blue.opacity(0.6), .purple.opacity(0.4)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .frame(maxWidth: .infinity, minHeight: 400)
    }

    private func deleteBriefing() async {
        do {
            try await apiClient.deleteBriefing(id: briefingId)
            eventManager.emit(.briefingDeleted(briefingId))
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func share() async {
        guard !isMutatingShare else { return }
        if briefing?.isPublic == true,
           let urlString = briefing?.shareUrl,
           let url = URL(string: urlString)
        {
            shareItem = ShareURLItem(url: url)
            return
        }
        await setPublic(true, presentShare: true)
    }

    private func generatePodcast() async {
        guard !isGeneratingPodcast else { return }
        isGeneratingPodcast = true
        defer { isGeneratingPodcast = false }
        do {
            let response = try await apiClient.generateBriefingPodcast(id: briefingId)
            switch response.status {
            case .queued:
                podcastToastMessage = "Podcast is generating. You'll be notified when ready."
            case .alreadyRunning:
                podcastToastMessage = "Podcast is already being generated."
            case .ready:
                podcastToastMessage = "Podcast already exists."
                await loadBriefing()
            }
        } catch {
            podcastToastMessage = "Failed to start podcast: \(error.localizedDescription)"
        }
    }

    private func setPublic(_ isPublic: Bool, presentShare: Bool = false) async {
        isMutatingShare = true
        defer { isMutatingShare = false }
        do {
            let updated = try await apiClient.updateBriefing(id: briefingId, isPublic: isPublic)
            eventManager.emit(.briefingUpdated(updated))
            // Re-fetch to keep linked documents (PATCH response omits them).
            await loadBriefing()
            if presentShare, let urlString = updated.shareUrl, let url = URL(string: urlString) {
                shareItem = ShareURLItem(url: url)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func loadBriefing() async {
        isLoading = true
        error = nil
        do {
            briefing = try await apiClient.getBriefing(id: briefingId)
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    private func formatDate(_ string: String) -> String {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = iso.date(from: string) { return formatted(date) }
        iso.formatOptions = [.withInternetDateTime]
        if let date = iso.date(from: string) { return formatted(date) }
        let sqlite = DateFormatter()
        sqlite.dateFormat = "yyyy-MM-dd HH:mm:ss"
        sqlite.timeZone = TimeZone(identifier: "UTC")
        if let date = sqlite.date(from: string) { return formatted(date) }
        return string
    }

    private func formatted(_ date: Date) -> String {
        date.formatted(.dateTime.month(.wide).day().year().hour().minute())
    }
}

private struct ShareURLItem: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

#if os(iOS)
private struct ShareActivityView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context _: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }

    func updateUIViewController(_: UIActivityViewController, context _: Context) {}
}
#endif
