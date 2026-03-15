import AssistantCore
import OSLog
import SwiftUI
import UserNotifications

private let logger = Logger(subsystem: "lindaAssistant", category: "PushNotification")

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
        logger.info("Received device token from APNs: \(tokenString.prefix(8))...")
        deviceToken = tokenString
        Task { await sendRegistrationIfReady() }
    }

    func registerWithBackend(apiClient: APIClient) async {
        self.apiClient = apiClient
        logger.info("Waiting for device token from APNs...")
        // Wait briefly for APNs to deliver the device token (typically <500ms on real devices)
        for _ in 0 ..< 20 where deviceToken == nil {
            try? await Task.sleep(for: .milliseconds(100))
        }
        if deviceToken == nil {
            logger.warning("Device token not received after 2s wait")
        }
        await sendRegistrationIfReady()
    }

    func forceReRegister() {
        logger.info("Force re-registering device token")
        didRegister = false
        Task { await sendRegistrationIfReady() }
    }

    private func sendRegistrationIfReady() async {
        guard let token = deviceToken, let apiClient, !didRegister else {
            logger
                .debug(
                    "Registration not ready — token: \(self.deviceToken != nil), apiClient: \(self.apiClient != nil), didRegister: \(self.didRegister)"
                )
            return
        }
        didRegister = true
        logger.info("Sending device token to backend: \(token.prefix(8))...")
        do {
            _ = try await apiClient.registerDevice(RegisterDevice(deviceToken: token))
            logger.info("Device token registered successfully")
        } catch {
            didRegister = false
            logger.error("Failed to register device token: \(error)")
        }
    }
}
