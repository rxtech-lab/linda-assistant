import MarkdownUI
import SwiftUI

private struct TappableMarkdownImagesModifier: ViewModifier {
    @State private var selectedImage: SelectedMarkdownImage?

    func body(content: Content) -> some View {
        content
            .markdownImageProvider(TappableImageProvider(onTap: { url in
                selectedImage = SelectedMarkdownImage(url: url)
            }))
        #if os(iOS)
            .fullScreenCover(item: $selectedImage) { selectedImage in
                MarkdownImageViewerCover(imageURL: selectedImage.url) {
                    self.selectedImage = nil
                }
            }
        #else
            .sheet(item: $selectedImage) { selectedImage in
                MarkdownImageViewerCover(imageURL: selectedImage.url) {
                    self.selectedImage = nil
                }
                .frame(minWidth: 600, minHeight: 500)
            }
        #endif
    }
}

private struct SelectedMarkdownImage: Identifiable {
    let id = UUID()
    let url: URL
}

private struct MarkdownImageViewerCover: View {
    let imageURL: URL
    let onDismiss: () -> Void

    var body: some View {
        NavigationStack {
            ImageViewerView(imageURL: imageURL)
                .navigationBarTitleDisplayModeInlineIfAvailable()
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        #if os(iOS)
                            Button {
                                onDismiss()
                            } label: {
                                Image(systemName: "xmark")
                                    .font(.body.weight(.semibold))
                                    .foregroundStyle(.white)
                            }
                        #else
                            Button("Done") {
                                onDismiss()
                            }
                        #endif
                    }
                }
            #if os(iOS)
                .toolbarBackground(.hidden, for: .navigationBar)
            #endif
        }
    }
}

extension View {
    func tappableMarkdownImages() -> some View {
        modifier(TappableMarkdownImagesModifier())
    }
}

private extension View {
    @ViewBuilder
    func navigationBarTitleDisplayModeInlineIfAvailable() -> some View {
        #if os(iOS)
            navigationBarTitleDisplayMode(.inline)
        #else
            self
        #endif
    }
}
