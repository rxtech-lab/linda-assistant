import AssistantCore
import Kingfisher
import SwiftUI

/// Full-screen slide viewer with horizontal paging and pinch-to-zoom on each slide.
struct SlideViewerSheet: View {
    @Environment(AuthManager.self) private var authManager
    @Environment(\.dismiss) private var dismiss

    let deckId: String

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    @State private var deck: SlideDeck?
    @State private var isLoading = true
    @State private var loadError: String?
    @State private var currentPage: Int? = 0
    @State private var isExporting = false
    @State private var showShareSheet = false
    @State private var shareURL: URL?
    @State private var exportError: String?
    @State private var showControls = true

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()

                if isLoading {
                    ProgressView("Loading slides...")
                        .tint(.white)
                        .foregroundStyle(.white)
                } else if let error = loadError {
                    VStack(spacing: 16) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.largeTitle)
                            .foregroundStyle(.secondary)
                        Text(error)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                        Button("Retry") {
                            Task { await loadDeck(force: true) }
                        }
                        .buttonStyle(.bordered)
                        .tint(.white)
                    }
                    .padding()
                } else if let pages = deck?.pages, !pages.isEmpty {
                    // Fullscreen paging slide viewer using ScrollView
                    GeometryReader { geometry in
                        ScrollView(.horizontal, showsIndicators: false) {
                            LazyHStack(spacing: 0) {
                                ForEach(Array(pages.enumerated()), id: \.element.id) { index, page in
                                    ZoomableSlideView(page: page) {
                                        withAnimation(.easeInOut(duration: 0.2)) {
                                            showControls.toggle()
                                        }
                                    }
                                    .frame(width: geometry.size.width, height: geometry.size.height)
                                    .id(index)
                                }
                            }
                            .scrollTargetLayout()
                        }
                        .scrollTargetBehavior(.paging)
                        .scrollPosition(id: $currentPage)
                    }
                    .ignoresSafeArea()
                } else {
                    VStack(spacing: 12) {
                        Image(systemName: "rectangle.stack")
                            .font(.largeTitle)
                            .foregroundStyle(.secondary)
                        Text("No slides in this deck.")
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }

                ToolbarItem(placement: .principal) {
                    VStack(spacing: 2) {
                        Text(deck?.title ?? "Slides")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.white)
                            .lineLimit(1)

                        if let pageCount = deck?.pages?.count, pageCount > 0 {
                            Text("\((currentPage ?? 0) + 1) of \(pageCount)")
                                .font(.caption)
                                .foregroundStyle(.white.opacity(0.75))
                        }
                    }
                }

                ToolbarItem(placement: .primaryAction) {
                    exportMenu
                }
            }
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.hidden, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar(showControls ? .visible : .hidden, for: .navigationBar)
            #endif
        }
        #if os(iOS)
        .statusBarHidden(!showControls)
        #endif
        .alert("Export Error", isPresented: .init(
            get: { exportError != nil },
            set: { if !$0 { exportError = nil } }
        )) {
            Button("OK") { exportError = nil }
        } message: {
            Text(exportError ?? "")
        }
        #if os(iOS)
        .sheet(isPresented: $showShareSheet) {
            if let url = shareURL {
                ShareSheet(url: url)
            }
        }
        #endif
        .overlay {
            if isExporting {
                ZStack {
                    Color.black.opacity(0.5)
                    ProgressView("Exporting...")
                        .tint(.white)
                        .foregroundStyle(.white)
                        .padding()
                        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
                }
                .ignoresSafeArea()
            }
        }
        .task(id: deckId) {
            await loadDeck()
        }
    }

    private var exportMenu: some View {
        Menu {
            Button {
                Task { await exportPDF() }
            } label: {
                Label("Export as PDF", systemImage: "doc.richtext")
            }

            Button {
                Task { await exportPPTX() }
            } label: {
                Label("Export as PowerPoint", systemImage: "doc.text")
            }
        } label: {
            Image(systemName: "square.and.arrow.up")
        }
        .disabled(isExporting || deck?.pages?.isEmpty != false)
    }

    // MARK: - Data Loading

    private func loadDeck(force: Bool = false) async {
        print("[Slide] Loading deck...")
        if !force,
           let deck,
           deck.id == deckId,
           loadError == nil,
           let pages = deck.pages,
           !pages.isEmpty
        {
            return
        }

        isLoading = true
        loadError = nil
        do {
            deck = try await apiClient.getSlideDeck(id: deckId)
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }

    private func exportPDF() async {
        isExporting = true
        defer { isExporting = false }
        do {
            let data = try await apiClient.exportSlideDeckPDF(id: deckId)
            let title = deck?.title ?? "slides"
            let safeName = title.replacingOccurrences(
                of: "[^a-zA-Z0-9\\-_ ]",
                with: "",
                options: .regularExpression
            )
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(safeName).pdf")
            try data.write(to: url)
            shareURL = url
            showShareSheet = true
        } catch {
            exportError = error.localizedDescription
        }
    }

    private func exportPPTX() async {
        isExporting = true
        defer { isExporting = false }
        do {
            let data = try await apiClient.exportSlideDeckPPTX(id: deckId)
            let title = deck?.title ?? "slides"
            let safeName = title.replacingOccurrences(
                of: "[^a-zA-Z0-9\\-_ ]",
                with: "",
                options: .regularExpression
            )
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(safeName).pptx")
            try data.write(to: url)
            shareURL = url
            showShareSheet = true
        } catch {
            exportError = error.localizedDescription
        }
    }
}

// MARK: - Zoomable Slide View

/// Individual slide with pinch-to-zoom and double-tap to toggle zoom.
private struct ZoomableSlideView: View {
    let page: SlidePage
    var onSingleTap: (() -> Void)?

    @State private var scale: CGFloat = 1.0
    @State private var lastScale: CGFloat = 1.0
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    var body: some View {
        GeometryReader { geometry in
            if let urlStr = page.imageUrl, let url = URL(string: urlStr) {
                KFImage(url)
                    .placeholder {
                        ProgressView()
                            .tint(.white)
                            .frame(width: geometry.size.width, height: geometry.size.height)
                    }
                    .onFailure { _ in }
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .scaleEffect(scale)
                    .offset(offset)
                    .gesture(pinchGesture)
                    .gesture(scale > 1.0 ? panGesture(in: geometry) : nil)
                    .onTapGesture(count: 2) {
                        withAnimation(.spring(response: 0.3)) {
                            if scale > 1.0 {
                                scale = 1.0
                                lastScale = 1.0
                                offset = .zero
                                lastOffset = .zero
                            } else {
                                scale = 3.0
                                lastScale = 3.0
                            }
                        }
                    }
                    .onTapGesture(count: 1) {
                        onSingleTap?()
                    }
                    .frame(width: geometry.size.width, height: geometry.size.height)
            } else {
                slidePlaceholder(systemImage: "photo", text: "Unavailable")
                    .frame(width: geometry.size.width, height: geometry.size.height)
            }
        }
    }

    private var pinchGesture: some Gesture {
        MagnifyGesture()
            .onChanged { value in
                let newScale = lastScale * value.magnification
                scale = min(max(newScale, 1.0), 5.0)
            }
            .onEnded { _ in
                lastScale = scale
                if scale <= 1.0 {
                    withAnimation(.spring(response: 0.3)) {
                        offset = .zero
                        lastOffset = .zero
                    }
                }
            }
    }

    /// Pan gesture only active when zoomed in, so TabView paging works at 1x scale.
    private func panGesture(in geometry: GeometryProxy) -> some Gesture {
        DragGesture()
            .onChanged { value in
                let maxX = geometry.size.width * (scale - 1) / 2
                let maxY = geometry.size.height * (scale - 1) / 2
                offset = CGSize(
                    width: min(max(lastOffset.width + value.translation.width, -maxX), maxX),
                    height: min(max(lastOffset.height + value.translation.height, -maxY), maxY)
                )
            }
            .onEnded { _ in
                lastOffset = offset
            }
    }

    private func slidePlaceholder(systemImage: String, text: String) -> some View {
        VStack(spacing: 8) {
            Image(systemName: systemImage)
                .font(.title)
                .foregroundStyle(.secondary)
            Text(text)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: - ShareSheet

#if os(iOS)
private struct ShareSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context _: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }

    func updateUIViewController(_: UIActivityViewController, context _: Context) {}
}
#endif
