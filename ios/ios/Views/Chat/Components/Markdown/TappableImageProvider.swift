#if canImport(UIKit)
    import UIKit
#elseif canImport(AppKit)
    import AppKit
#endif
import Kingfisher
import MarkdownUI
import SwiftUI

struct TappableImageProvider: ImageProvider {
    let onTap: (URL) -> Void

    func makeImage(url: URL?) -> some View {
        TappableMarkdownImage(url: url, onTap: onTap)
    }
}

// MarkdownUI's image provider context does not always propose a finite width
// to inline images. Without a hard cap the intrinsic pixel size of large PNGs
// (e.g. matplotlib charts at 2400×2400) leaks into the layout and pushes
// sibling text past the screen edge. Same story for tables with .fixedSize
// cells — wrap the markdown column at the screen/window width to keep all
// blocks bounded. `containerRelativeFrame` looks like a cleaner fit, but
// binding to the nearest scroll container inside MarkdownUI's hierarchy
// stalls the layout pass.
func currentMaxContentWidth() -> CGFloat {
    #if canImport(UIKit)
        let scenes = UIApplication.shared.connectedScenes
        if let window = scenes
            .compactMap({ $0 as? UIWindowScene })
            .flatMap(\.windows)
            .first(where: { $0.isKeyWindow })
        {
            return window.bounds.width
        }
        return UIScreen.main.bounds.width
    #elseif canImport(AppKit)
        return NSScreen.main?.frame.width ?? 1024
    #else
        return 1024
    #endif
}

private struct TappableMarkdownImage: View {
    let url: URL?
    let onTap: (URL) -> Void

    var body: some View {
        if let url {
            Button {
                onTap(url)
            } label: {
                KFImage(url)
                    .placeholder {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                            .frame(height: 200)
                    }
                #if canImport(UIKit)
                    .onFailureImage(UIImage(systemName: "photo"))
                #elseif canImport(AppKit)
                    .onFailureImage(NSImage(systemSymbolName: "photo", accessibilityDescription: nil))
                #endif
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(maxWidth: currentMaxContentWidth())
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .buttonStyle(.plain)
        } else {
            Color.clear
                .frame(width: 0, height: 0)
        }
    }
}
