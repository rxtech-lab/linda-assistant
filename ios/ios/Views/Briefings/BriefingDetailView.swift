import AssistantCore
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
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        // Cover image
                        coverImage(for: briefing)

                        VStack(alignment: .leading, spacing: 12) {
                            if let date = briefing.createdAt {
                                Text(formatDate(date))
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }

                            Markdown(briefing.content)
                                .markdownTheme(.docC)

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
                    }
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
        .task {
            await loadBriefing()
        }
    }

    @ViewBuilder
    private func coverImage(for briefing: Briefing) -> some View {
        if let imageUrl = briefing.imageUrl, let url = URL(string: imageUrl) {
            AsyncImage(url: url) { phase in
                switch phase {
                    case let .success(image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                            .frame(maxWidth: .infinity, minHeight: 400)
                            .frame(height: 400)
                            .clipped()
                    case .failure:
                        placeholderGradient
                    @unknown default:
                        ProgressView()
                            .frame(maxWidth: .infinity, minHeight: 400)
                }
            }
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
