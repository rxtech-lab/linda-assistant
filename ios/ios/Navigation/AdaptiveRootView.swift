import SwiftUI

struct AdaptiveRootView: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var navigationManager = NavigationManager()

    var body: some View {
        Group {
            if horizontalSizeClass == .compact {
                TabBarView()
            } else {
                SidebarNavigationView()
            }
        }
        .environment(navigationManager)
    }
}
