import SwiftUI

struct AdaptiveRootView: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
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
    }
}
