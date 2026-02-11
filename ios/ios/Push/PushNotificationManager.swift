import AssistantCore
import SwiftUI
import UserNotifications

@Observable
final class PushNotificationManager: NSObject, @unchecked Sendable {
    var deviceToken: String?

    func requestPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, error in
            if granted {
                DispatchQueue.main.async {
                    #if canImport(UIKit)
                        UIApplication.shared.registerForRemoteNotifications()
                    #endif
                }
            }
            if let error {
                print("Push notification permission error: \(error)")
            }
        }
    }

    func handleDeviceToken(_ token: Data) {
        let tokenString = token.map { String(format: "%02.2hhx", $0) }.joined()
        deviceToken = tokenString
    }

    func registerWithBackend(apiClient: APIClient) async {
        guard let token = deviceToken else { return }
        do {
            _ = try await apiClient.registerDevice(RegisterDevice(deviceToken: token))
        } catch {
            print("Failed to register device: \(error)")
        }
    }
}
