import OSLog
import SwiftUI

#if canImport(UIKit)
    import UIKit

    typealias PlatformImage = UIImage
#elseif canImport(AppKit)
    import AppKit

    typealias PlatformImage = NSImage
#endif

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "app", category: "CachedAsyncImage")

struct CachedAsyncImage<Content: View>: View {
    private let url: URL?
    private let content: (AsyncImagePhase) -> Content

    @State private var loadedImage: PlatformImage?
    @State private var loadError: Error?
    @State private var hasLoaded = false

    private var phase: AsyncImagePhase {
        if let loadedImage {
            #if canImport(UIKit)
                return .success(Image(uiImage: loadedImage))
            #elseif canImport(AppKit)
                return .success(Image(nsImage: loadedImage))
            #endif
        } else if let loadError {
            return .failure(loadError)
        } else {
            return .empty
        }
    }

    init(url: URL?, @ViewBuilder content: @escaping (AsyncImagePhase) -> Content) {
        self.url = url
        self.content = content
    }

    var body: some View {
        content(phase)
            .background {
                Color.clear
                    .task(id: url) {
                        await load()
                    }
            }
    }

    private func load() async {
        loadedImage = nil
        loadError = nil
        hasLoaded = false

        print("[CachedAsyncImage] task fired, url: \(url?.absoluteString ?? "nil")")

        guard let url else { return }
        do {
            let data = try await ImageCacheManager.shared.data(for: url)
            logger.debug("Got \(data.count) bytes for: \(url.absoluteString)")
            if let platformImage = PlatformImage(data: data) {
                loadedImage = platformImage
                logger.debug("Image decoded successfully: \(url.absoluteString)")
            } else {
                logger.error("Failed to decode image data: \(url.absoluteString)")
                loadError = URLError(.cannotDecodeContentData)
            }
        } catch {
            logger.error("Failed to load image: \(url.absoluteString) — \(error.localizedDescription)")
            loadError = error
        }
        hasLoaded = true
    }
}

extension CachedAsyncImage where Content == AnyView {
    init(
        url: URL?,
        @ViewBuilder content: @escaping (Image) -> some View,
        @ViewBuilder placeholder: @escaping () -> some View
    ) {
        let wrappedContent = content
        let wrappedPlaceholder = placeholder
        self.init(url: url) { phase in
            AnyView(Group {
                if case let .success(image) = phase {
                    wrappedContent(image)
                } else {
                    wrappedPlaceholder()
                }
            })
        }
    }
}
