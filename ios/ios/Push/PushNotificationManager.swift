import AssistantCore
import CoreLocation
import OSLog
import SwiftUI
#if canImport(UIKit)
    import UIKit

    typealias BackgroundFetchResult = UIBackgroundFetchResult
#elseif canImport(AppKit)
    import AppKit

    /// macOS equivalent of UIBackgroundFetchResult for cross-platform compatibility
    enum BackgroundFetchResult {
        case newData
        case noData
        case failed
    }
#endif
import UserNotifications

private let logger = Logger(subsystem: "lindaAssistant", category: "PushNotification")

@Observable
final class PushNotificationManager: NSObject, @unchecked Sendable {
    var deviceToken: String?
    private var apiClient: APIClient?
    private var eventManager: EventManager?
    private var didRegister = false
    private let locationService = LocationService()

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

    func bindEventManager(_ manager: EventManager) {
        eventManager = manager
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

    /// Handle silent/background push notifications for auto-confirm location requests.
    func handleBackgroundNotification(
        userInfo: [AnyHashable: Any],
        completionHandler: @escaping (BackgroundFetchResult) -> Void
    ) {
        let type = userInfo["type"] as? String

        if type == "briefing-podcast-ready",
           let briefingId = userInfo["briefingId"] as? String,
           let podcastUrl = userInfo["podcastUrl"] as? String
        {
            logger.info("Briefing podcast ready: briefingId=\(briefingId)")
            eventManager?.emit(.briefingPodcastReady(briefingId: briefingId, podcastUrl: podcastUrl))
            completionHandler(.newData)
            return
        }

        if type == "audio-ready",
           let audioId = userInfo["audioId"] as? String
        {
            let audioUrl = userInfo["audioUrl"] as? String ?? ""
            logger.info("Audio ready: audioId=\(audioId)")
            eventManager?.emit(.audioReady(audioId: audioId, audioUrl: audioUrl))
            completionHandler(.newData)
            return
        }

        guard type == "location_request",
              let toolCallId = userInfo["toolCallId"] as? String
        else {
            completionHandler(.noData)
            return
        }

        logger.info("Background location request: toolCallId=\(toolCallId)")

        Task {
            guard let apiClient else {
                logger.error("No API client for background location response")
                completionHandler(.failed)
                return
            }

            do {
                let location = try await locationService.requestLocation()
                logger.info("Background location acquired: \(location.latitude), \(location.longitude)")

                let body = LocationResponse(
                    toolCallId: toolCallId,
                    action: "confirm",
                    latitude: location.latitude,
                    longitude: location.longitude,
                    accuracy: location.accuracy
                )
                _ = try await apiClient.sendLocationResponse(body)
                logger.info("Background location response sent successfully")
                completionHandler(.newData)
            } catch {
                logger.error("Background location failed: \(error)")
                // Send rejection if location is unavailable
                do {
                    let body = LocationResponse(toolCallId: toolCallId, action: "reject")
                    _ = try await apiClient.sendLocationResponse(body)
                    logger.info("Background location rejection sent")
                } catch {
                    logger.error("Failed to send location rejection: \(error)")
                }
                completionHandler(.failed)
            }
        }
    }
}
