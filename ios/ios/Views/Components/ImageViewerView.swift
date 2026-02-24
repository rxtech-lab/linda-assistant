import SwiftUI

struct ImageViewerView: View {
    let imageURL: URL

    @State private var scale: CGFloat = 1.0
    @State private var lastScale: CGFloat = 1.0
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    var body: some View {
        GeometryReader { geometry in
            AsyncImage(url: imageURL) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .scaleEffect(scale)
                        .offset(offset)
                        .gesture(
                            MagnifyGesture()
                                .onChanged { value in
                                    scale = lastScale * value.magnification
                                }
                                .onEnded { _ in
                                    lastScale = max(scale, 1.0)
                                    scale = max(scale, 1.0)
                                    if scale <= 1.0 {
                                        offset = .zero
                                        lastOffset = .zero
                                    }
                                }
                                .simultaneously(
                                    with: DragGesture()
                                        .onChanged { value in
                                            if scale > 1.0 {
                                                offset = CGSize(
                                                    width: lastOffset.width + value.translation.width,
                                                    height: lastOffset.height + value.translation.height
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
