import OSLog
import SwiftUI

private let deepLinkLogger = Logger(subsystem: "lindaAssistant", category: "DeepLink")

struct AdaptiveRootView: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(PushNotificationManager.self) private var pushManager
    @State private var navigationManager = NavigationManager()

    var body: some View {
        @Bindable var nav = navigationManager

        Group {
            if horizontalSizeClass == .compact {
                NavigationStack(path: $nav.chatPath) {
                    ChatTabView()
                }
                #if os(iOS)
                .fullScreenCover(isPresented: $nav.showingTabs) {
                    TabBarView()
                }
                #endif
            } else {
                SidebarNavigationView()
            }
        }
        .environment(navigationManager)
        .audioViewerPresenter(audioId: $nav.pendingAudioId)
        .task {
            deepLinkLogger.info("AdaptiveRootView.task fired — calling pushManager.bind(navigationManager:)")
            pushManager.bind(navigationManager: navigationManager)
        }
    }
}
