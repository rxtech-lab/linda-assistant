import MarkdownUI
import SwiftUI

private struct TappableMarkdownImagesModifier: ViewModifier {
    @State private var selectedImageURL: URL?

    func body(content: Content) -> some View {
        content
            .markdownImageProvider(TappableImageProvider(onTap: { url in
                selectedImageURL = url
            }))
            #if os(iOS)
            .fullScreenCover(isPresented: Binding(
                get: { selectedImageURL != nil },
                set: { if !$0 { selectedImageURL = nil } }
            )) {
                if let url = selectedImageURL {
                    NavigationStack {
                        ImageViewerView(imageURL: url)
                            .navigationBarTitleDisplayModeInlineIfAvailable()
                            .toolbar {
                                ToolbarItem(placement: .cancellationAction) {
                                    Button {
                                        selectedImageURL = nil
                                    } label: {
                                        Image(systemName: "xmark.circle.fill")
                                            .font(.title2)
                                            .symbolRenderingMode(.palette)
                                            .foregroundStyle(.white, .black.opacity(0.6))
                                    }
                                }
                            }
                            .toolbarBackground(.hidden, for: .navigationBar)
                    }
                }
            }
            #else
            .sheet(isPresented: Binding(
                get: { selectedImageURL != nil },
                set: { if !$0 { selectedImageURL = nil } }
            )) {
                if let url = selectedImageURL {
                    NavigationStack {
                        ImageViewerView(imageURL: url)
                            .toolbar {
                                ToolbarItem(placement: .cancellationAction) {
                                    Button("Done") {
                                        selectedImageURL = nil
                                    }
                                }
                            }
                    }
                    .frame(minWidth: 600, minHeight: 500)
                }
            }
            #endif
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
