import AssistantCore
import SwiftUI
import UserNotifications

@Observable
final class PushNotificationManager: NSObject, @unchecked Sendable {
    var deviceToken: String?
    private var apiClient: APIClient?
    private var didRegister = false

    func requestPermission() {
        // Register for remote notifications first — this fetches the device token
        // independently of user notification authorization.
        DispatchQueue.main.async {
            #if canImport(UIKit)
                UIApplication.shared.registerForRemoteNotifications()
            #elseif canImport(AppKit)
                NSApplication.shared.registerForRemoteNotifications()
            #endif
        }

        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { _, error in
            if let error {
                print("Push notification permission error: \(error)")
            }
        }
    }

    func handleDeviceToken(_ token: Data) {
        let tokenString = token.map { String(format: "%02.2hhx", $0) }.joined()
        deviceToken = tokenString
        Task { await sendRegistrationIfReady() }
    }

    func registerWithBackend(apiClient: APIClient) async {
        self.apiClient = apiClient
        // Wait briefly for APNs to deliver the device token (typically <500ms on real devices)
        for _ in 0..<20 where deviceToken == nil {
            try? await Task.sleep(for: .milliseconds(100))
        }
        await sendRegistrationIfReady()
    }

    func forceReRegister() {
        didRegister = false
        Task { await sendRegistrationIfReady() }
    }

    private func sendRegistrationIfReady() async {
        guard let token = deviceToken, let apiClient, !didRegister else { return }
        didRegister = true
        do {
            _ = try await apiClient.registerDevice(RegisterDevice(deviceToken: token))
        } catch {
            didRegister = false
            print("Failed to register device: \(error)")
        }
    }
}
