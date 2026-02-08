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
                .task { await authManager.checkExistingAuth() }
        }
    }
}
