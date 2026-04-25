import AssistantCore
import OSLog
import SwiftUI

private let deepLinkLogger = Logger(subsystem: "lindaAssistant", category: "DeepLink")

struct AdaptiveRootView: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(PushNotificationManager.self) private var pushManager
    @Environment(EventManager.self) private var eventManager
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
        .task {
            for await event in eventManager.stream {
                switch event {
                    case let .openBriefingRequested(id):
                        deepLinkLogger.info("AdaptiveRootView received .openBriefingRequested(id: \(id))")
                        navigationManager.openDeepLink(.briefing(id: id))
                    case let .openTaskRequested(id):
                        deepLinkLogger.info("AdaptiveRootView received .openTaskRequested(id: \(id))")
                        navigationManager.openDeepLink(.task(id: id))
                    default:
                        break
                }
            }
        }
    }
}
