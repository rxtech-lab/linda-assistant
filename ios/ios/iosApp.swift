import AssistantCore
import os
import SwiftUI
#if os(macOS)
    import Sparkle
#endif

private let appLogger = Logger(subsystem: "lindaAssistant", category: "iosApp")

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

        func application(
            _: UIApplication,
            didReceiveRemoteNotification userInfo: [AnyHashable: Any],
            fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
        ) {
            pushManager?.handleBackgroundNotification(userInfo: userInfo, completionHandler: completionHandler)
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
    @Environment(\.scenePhase) private var scenePhase

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
                .onOpenURL { url in
                    appLogger.info("onOpenURL fired: \(url.absoluteString)")
                    if url.scheme == "rxlablinda", url.host == "share" {
                        appLogger.info("Emitting .sharePending from onOpenURL")
                        eventManager.emit(.sharePending)
                    }
                }
        }
        .onChange(of: scenePhase) { _, phase in
            appLogger.info("scenePhase changed to \(String(describing: phase))")
            if phase == .active {
                eventManager.emit(.sharePending)
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
