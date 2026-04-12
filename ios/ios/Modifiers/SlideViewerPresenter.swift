import SwiftUI

/// Presents a `SlideViewerSheet` as fullScreenCover on iOS and sheet on macOS.
/// Attach to any view and bind `deckId` to an optional `String?` state.
struct SlideViewerPresenter: ViewModifier {
    @Binding var deckId: String?

    private var isPresented: Binding<Bool> {
        Binding(
            get: { deckId != nil },
            set: { if !$0 { deckId = nil } }
        )
    }

    func body(content: Content) -> some View {
        #if os(iOS)
            content.fullScreenCover(isPresented: isPresented) {
                SlideViewerSheet(deckId: deckId ?? "")
            }
        #else
            content.sheet(isPresented: isPresented) {
                SlideViewerSheet(deckId: deckId ?? "")
            }
        #endif
    }
}

extension View {
    func slideViewerPresenter(deckId: Binding<String?>) -> some View {
        modifier(SlideViewerPresenter(deckId: deckId))
    }
}
