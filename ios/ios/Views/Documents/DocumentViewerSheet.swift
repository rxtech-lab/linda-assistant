import AssistantCore
import MarkdownUI
import SwiftUI
import WebKit

/// Lightweight identifiable wrapper for presenting a document sheet by ID.
struct DocumentSheetItem: Identifiable {
    let id: String
    var title: String?
}

struct DocumentViewerSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AuthManager.self) private var authManager
    let documentId: String
    var initialTitle: String?
    @State private var document: Document?
    @State private var isLoading = true
    @State private var loadError: String?
    @State private var isDownloading = false
    @State private var showShareSheet = false
    @State private var shareURL: URL?
    @State private var downloadError: String?

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView("Loading document...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error = loadError {
                    ContentUnavailableView {
                        Label("Failed to Load", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Retry") {
                            Task { await loadDocument() }
                        }
                    }
                } else if let document {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 0) {
                            if document.format == "markdown" {
                                Markdown(document.content)
                                    .markdownTheme(.docC)
                                    .padding()
                            } else {
                                HTMLContentView(htmlString: document.content)
                                    .frame(minHeight: 400)
                            }
                        }
                    }
                    .overlay {
                        if isDownloading {
                            ZStack {
                                Color.black.opacity(0.3)
                                    .ignoresSafeArea()
                                VStack(spacing: 12) {
                                    ProgressView()
                                        .controlSize(.large)
                                    Text("Generating PDF...")
                                        .font(.subheadline.weight(.medium))
                                        .foregroundStyle(.white)
                                }
                                .padding(24)
                                .background(.ultraThinMaterial)
                                .clipShape(RoundedRectangle(cornerRadius: 16))
                            }
                        }
                    }
                }
            }
            .navigationTitle(document?.title ?? initialTitle ?? "Document")
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") { dismiss() }
                    }

                    if document != nil {
                        ToolbarItem(placement: .primaryAction) {
                            Menu {
                                Button {
                                    Task { await downloadOriginal() }
                                } label: {
                                    Label("Download Original", systemImage: "doc.text")
                                }

                                Button {
                                    Task { await downloadPDF() }
                                } label: {
                                    Label("Download PDF", systemImage: "doc.richtext")
                                }
                            } label: {
                                if isDownloading {
                                    ProgressView()
                                        .controlSize(.small)
                                } else {
                                    Image(systemName: "square.and.arrow.down")
                                }
                            }
                            .disabled(isDownloading)
                        }
                    }
                }
                .alert("Download Error", isPresented: .init(
                    get: { downloadError != nil },
                    set: { if !$0 { downloadError = nil } }
                )) {
                    Button("OK") { downloadError = nil }
                } message: {
                    if let downloadError {
                        Text(downloadError)
                    }
                }
                .sheet(isPresented: $showShareSheet) {
                    if let shareURL {
                        ShareSheet(url: shareURL)
                    }
                }
        }
        #if os(macOS)
        .frame(minWidth: 700, idealWidth: 800, minHeight: 500, idealHeight: 700)
        #endif
        .task {
            await loadDocument()
        }
    }

    private func loadDocument() async {
        isLoading = true
        loadError = nil
        do {
            document = try await apiClient.getDocument(id: documentId)
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }

    private func downloadOriginal() async {
        guard let document else { return }
        isDownloading = true
        defer { isDownloading = false }

        let ext = document.format == "markdown" ? "md" : "html"
        let filename = "\(sanitizeFilename(document.title)).\(ext)"
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(filename)

        do {
            try document.content.write(to: tempURL, atomically: true, encoding: .utf8)
            shareURL = tempURL
            showShareSheet = true
        } catch {
            downloadError = error.localizedDescription
        }
    }

    private func downloadPDF() async {
        isDownloading = true
        defer { isDownloading = false }

        do {
            let data = try await apiClient.downloadDocumentPDF(id: documentId)
            let filename = "\(sanitizeFilename(document?.title ?? "document")).pdf"
            let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
            try data.write(to: tempURL)
            shareURL = tempURL
            showShareSheet = true
        } catch {
            downloadError = error.localizedDescription
        }
    }

    private func sanitizeFilename(_ name: String) -> String {
        let invalidChars = CharacterSet(charactersIn: "/\\?%*|\"<>:")
        return name.components(separatedBy: invalidChars).joined(separator: "_")
    }
}

// MARK: - HTML Content View

#if os(iOS)
    private struct HTMLContentView: UIViewRepresentable {
        let htmlString: String

        func makeUIView(context: Context) -> WKWebView {
            let webView = WKWebView()
            webView.scrollView.isScrollEnabled = false
            webView.loadHTMLString(htmlString, baseURL: nil)
            return webView
        }

        func updateUIView(_ uiView: WKWebView, context: Context) {}
    }
#else
    private struct HTMLContentView: NSViewRepresentable {
        let htmlString: String

        func makeNSView(context: Context) -> WKWebView {
            let webView = WKWebView()
            webView.loadHTMLString(htmlString, baseURL: nil)
            return webView
        }

        func updateNSView(_ nsView: WKWebView, context: Context) {}
    }
#endif

// MARK: - Share Sheet

#if os(iOS)
    private struct ShareSheet: UIViewControllerRepresentable {
        let url: URL

        func makeUIViewController(context: Context) -> UIActivityViewController {
            UIActivityViewController(activityItems: [url], applicationActivities: nil)
        }

        func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
    }
#else
    private struct ShareSheet: View {
        @Environment(\.dismiss) private var dismiss
        let url: URL

        private var fileIcon: String {
            let ext = url.pathExtension.lowercased()
            switch ext {
            case "pdf":
                return "doc.richtext.fill"
            case "md", "markdown":
                return "doc.text.fill"
            case "html", "htm":
                return "globe"
            default:
                return "doc.fill"
            }
        }

        var body: some View {
            VStack(spacing: 20) {
                // File icon and name
                VStack(spacing: 12) {
                    Image(systemName: fileIcon)
                        .font(.system(size: 48))
                        .foregroundStyle(.blue)

                    Text(url.lastPathComponent)
                        .font(.headline)
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                }

                Text("File saved successfully")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                // Action buttons
                VStack(spacing: 10) {
                    Button {
                        NSWorkspace.shared.activateFileViewerSelecting([url])
                    } label: {
                        Label("Reveal in Finder", systemImage: "folder")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)

                    Button {
                        dismiss()
                    } label: {
                        Text("Done")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                }
            }
            .padding(24)
            .frame(width: 320)
        }
    }
#endif

// MARK: - Preview

private struct DocumentViewerPreview: View {
    let document: Document
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if document.format == "markdown" {
                        Markdown(document.content)
                            .markdownTheme(.chat)
                            .padding()
                    } else {
                        HTMLContentView(htmlString: document.content)
                            .frame(minHeight: 400)
                    }
                }
            }
            .navigationTitle(document.title)
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") { dismiss() }
                    }
                    ToolbarItem(placement: .primaryAction) {
                        Menu {
                            Button {} label: {
                                Label("Download Original", systemImage: "doc.text")
                            }
                            Button {} label: {
                                Label("Download PDF", systemImage: "doc.richtext")
                            }
                        } label: {
                            Image(systemName: "square.and.arrow.down")
                        }
                    }
                }
        }
    }
}

#Preview("Markdown Document") {
    DocumentViewerPreview(
        document: Document(
            id: "preview-1",
            title: "Meeting Notes",
            format: "markdown",
            content: """
            # Meeting Notes

            ## Attendees
            - Alice
            - Bob
            - Charlie

            ## Agenda
            1. Project update
            2. Timeline review
            3. Next steps

            ## Notes
            The team discussed the **current progress** on the project. Key highlights:

            - Feature A is complete
            - Feature B is in progress
            - Feature C needs more planning

            > "We should prioritize user feedback" - Alice

            ### Action Items
            - [ ] Review PRs by Friday
            - [ ] Schedule follow-up meeting
            """
        )
    )
}

#Preview("HTML Document") {
    DocumentViewerPreview(
        document: Document(
            id: "preview-2",
            title: "Status Report",
            format: "html",
            content: """
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: -apple-system, sans-serif; padding: 20px; }
                    h1 { color: #333; }
                    .highlight { background: #fff3cd; padding: 10px; border-radius: 8px; }
                </style>
            </head>
            <body>
                <h1>Status Report</h1>
                <p>This is an HTML formatted document.</p>
                <div class="highlight">
                    <strong>Important:</strong> All tasks are on track.
                </div>
            </body>
            </html>
            """
        )
    )
}

#Preview("Loading State") {
    DocumentViewerSheet(
        documentId: "preview-loading",
        initialTitle: "Loading Document"
    )
    .environment(AuthManager())
}

#if os(iOS)
    #Preview("Share Sheet (iOS)") {
        ShareSheet(url: URL(fileURLWithPath: "/tmp/Meeting Notes.pdf"))
    }
#else
    #Preview("Share Sheet (macOS)") {
        ShareSheet(url: URL(fileURLWithPath: "/tmp/Meeting Notes.pdf"))
    }
#endif
