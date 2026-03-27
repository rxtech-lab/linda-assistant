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
                CachedAsyncImage(url: url) { phase in
                    switch phase {
                        case let .success(image):
                            image
                                .resizable()
                                .aspectRatio(contentMode: .fit)
                                .frame(maxWidth: .infinity)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                        case .failure:
                            VStack(spacing: 8) {
                                Image(systemName: "photo")
                                    .font(.system(size: 32))
                                    .foregroundStyle(.secondary)
                                Text("Image unavailable")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity)
                            .frame(height: 120)
                            .background(.quaternary)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                        default:
                            ProgressView()
                                .frame(maxWidth: .infinity)
                                .frame(height: 200)
                    }
                }
            }
            .buttonStyle(.plain)
        } else {
            Color.clear
                .frame(width: 0, height: 0)
        }
    }
}
