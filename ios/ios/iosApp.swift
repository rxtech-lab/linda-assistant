import AssistantCore
import SwiftUI

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

@main
struct iosApp: App {
    #if canImport(UIKit)
        @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    #elseif os(macOS)
        @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    #endif
    @State private var authManager = AuthManager()
    @State private var eventManager = EventManager()
    @State private var pushManager = PushNotificationManager()

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
        #endif
    }
}
