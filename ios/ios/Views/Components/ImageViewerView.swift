import SwiftUI

struct ImageViewerView: View {
    let imageURL: URL

    @State private var scale: CGFloat = 1.0
    @State private var lastScale: CGFloat = 1.0
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    var body: some View {
        GeometryReader { geometry in
            CachedAsyncImage(url: imageURL) { phase in
                switch phase {
                    case let .success(image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .scaleEffect(scale)
                            .offset(offset)
                            .gesture(
                                MagnifyGesture()
                                    .onChanged { value in
                                        let newScale = lastScale * value.magnification
                                        scale = min(max(newScale, 1.0), 5.0)
                                    }
                                    .onEnded { _ in
                                        lastScale = scale
                                        if scale <= 1.0 {
                                            withAnimation {
                                                offset = .zero
                                                lastOffset = .zero
                                            }
                                        }
                                    }
                                    .simultaneously(
                                        with: DragGesture()
                                            .onChanged { value in
                                                if scale > 1.0 {
                                                    let maxOffset = geometry.size.width * (scale - 1) / 2
                                                    let newWidth = lastOffset.width + value.translation.width
                                                    let newHeight = lastOffset.height + value.translation.height
                                                    offset = CGSize(
                                                        width: min(max(newWidth, -maxOffset), maxOffset),
                                                        height: min(max(newHeight, -maxOffset), maxOffset)
                                                    )
                                                }
                                            }
                                            .onEnded { _ in
                                                lastOffset = offset
                                            }
                                    )
                            )
                            .onTapGesture(count: 2) {
                                withAnimation {
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
                            .frame(
                                width: geometry.size.width,
                                height: geometry.size.height
                            )
                    case .failure:
                        VStack(spacing: 16) {
                            Image(systemName: "photo.badge.exclamationmark")
                                .font(.system(size: 48))
                                .foregroundStyle(.secondary)
                            Text("Failed to load image")
                                .font(.headline)
                                .foregroundStyle(.secondary)
                        }
                        .frame(
                            width: geometry.size.width,
                            height: geometry.size.height
                        )
                    default:
                        ProgressView()
                            .frame(
                                width: geometry.size.width,
                                height: geometry.size.height
                            )
                }
            }
        }
        .background(.black)
    }
}
