import AssistantCore
import SwiftUI
#if os(macOS)
    import Sparkle
#endif

#if os(macOS)
    private var updaterController: SPUStandardUpdaterController?
#endif

#if canImport(UIKit)
    class AppDelegate: NSObject, UIApplicationDelegate {
        var pushManager: PushNotificationManager?

        func application(
            _: UIApplication,
            didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
        ) {
            pushManager?.handleDeviceToken(deviceToken)
        }

        func application(
            _: UIApplication,
            didFailToRegisterForRemoteNotificationsWithError error: Error
        ) {
            print("Failed to register for remote notifications: \(error)")
        }
    }
#elseif os(macOS)
    class AppDelegate: NSObject, NSApplicationDelegate {
        var pushManager: PushNotificationManager?

        func application(
            _: NSApplication,
            didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
        ) {
            pushManager?.handleDeviceToken(deviceToken)
        }

        func application(
            _: NSApplication,
            didFailToRegisterForRemoteNotificationsWithError error: Error
        ) {
            print("Failed to register for remote notifications: \(error)")
        }
    }
#endif

/// Creates AuthManager, clearing keychain first if --reset-auth flag is present
private func createAuthManager() -> AuthManager {
    if CommandLine.arguments.contains("--reset-auth") {
        KeychainHelper.deleteAll()
    }
    return AuthManager()
}

@main
struct iosApp: App {
    #if canImport(UIKit)
        @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    #elseif os(macOS)
        @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    #endif
    @State private var authManager = createAuthManager()
    @State private var eventManager = EventManager()
    @State private var pushManager = PushNotificationManager()

    init() {
        #if os(macOS)
            updaterController = SPUStandardUpdaterController(
                startingUpdater: true,
                updaterDelegate: nil,
                userDriverDelegate: nil
            )
        #endif
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(authManager)
                .environment(eventManager)
                .environment(pushManager)
                .onAppear {
                    appDelegate.pushManager = pushManager
                }
        }
        #if os(macOS)
        .windowStyle(.hiddenTitleBar)
        .commands {
            CommandGroup(after: .appInfo) {
                Button("Check for Updates...") {
                    updaterController?.checkForUpdates(nil)
                }
            }
        }
        #endif
    }
}
