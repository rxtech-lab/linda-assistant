import AssistantCore
import SwiftUI

@main
struct iosApp: App {
    @State private var authManager = AuthManager()
    @State private var eventManager = EventManager()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(authManager)
                .environment(eventManager)
        }
        #if os(macOS)
        .windowStyle(.hiddenTitleBar)
        #endif
    }
}
