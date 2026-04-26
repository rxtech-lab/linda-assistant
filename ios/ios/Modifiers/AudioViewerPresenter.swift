import OSLog
import SwiftUI

private let deepLinkLogger = Logger(subsystem: "lindaAssistant", category: "DeepLink")

/// Presents an `AudioViewerSheet` as fullScreenCover on iOS and sheet on macOS.
/// Attach to any view and bind `audioId` to an optional `String?` state.
struct AudioViewerPresenter: ViewModifier {
    @Binding var audioId: String?

    private var isPresented: Binding<Bool> {
        Binding(
            get: { audioId != nil },
            set: { if !$0 { audioId = nil } }
        )
    }

    func body(content: Content) -> some View {
        #if os(iOS)
            content.fullScreenCover(isPresented: isPresented) {
                let _ = deepLinkLogger.info("AudioViewerPresenter presenting AudioViewerSheet for id=\(audioId ?? "nil")")
                AudioViewerSheet(audioId: audioId ?? "", initialTitle: "Audio")
            }
        #else
            content.sheet(isPresented: isPresented) {
                let _ = deepLinkLogger.info("AudioViewerPresenter presenting AudioViewerSheet for id=\(audioId ?? "nil")")
                AudioViewerSheet(audioId: audioId ?? "", initialTitle: "Audio")
            }
        #endif
    }
}

extension View {
    func audioViewerPresenter(audioId: Binding<String?>) -> some View {
        modifier(AudioViewerPresenter(audioId: audioId))
    }
}
