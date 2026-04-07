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
                    .frame(maxWidth: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .buttonStyle(.plain)
        } else {
            Color.clear
                .frame(width: 0, height: 0)
        }
    }
}
