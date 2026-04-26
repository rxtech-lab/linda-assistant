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
private let deepLinkLogger = Logger(subsystem: "lindaAssistant", category: "DeepLink")

@Observable
final class PushNotificationManager: NSObject, UNUserNotificationCenterDelegate, @unchecked Sendable {
    var deviceToken: String?
    /// APNs push-to-start token for Live Activities (iOS 17.2+). Sent alongside
    /// `deviceToken` to `/api/devices` so the backend can remotely start a Live
    /// Activity for any task that the user opted into.
    var liveActivityStartToken: String?
    private var apiClient: APIClient?
    private var eventManager: EventManager?
    private var navigationManager: NavigationManager?
    private var pendingUserInfo: [AnyHashable: Any]?
    private var didRegister = false
    private var lastRegisteredLiveActivityToken: String?
    private let locationService = LocationService()

    func requestPermission() {
        UNUserNotificationCenter.current().delegate = self
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

    func bind(navigationManager: NavigationManager) {
        let hadPending = pendingUserInfo != nil
        self.navigationManager = navigationManager
        deepLinkLogger.info("PushNotificationManager.bind() called — pendingUserInfo: \(hadPending ? "yes (will replay)" : "none")")
        if let userInfo = pendingUserInfo {
            pendingUserInfo = nil
            routeTap(userInfo: userInfo)
        }
    }

    func forceReRegister() {
        logger.info("Force re-registering device token")
        didRegister = false
        Task { await sendRegistrationIfReady() }
    }

    private func sendRegistrationIfReady() async {
        guard let token = deviceToken, let apiClient else {
            logger
                .debug(
                    "Registration not ready — token: \(self.deviceToken != nil), apiClient: \(self.apiClient != nil), didRegister: \(self.didRegister)"
                )
            return
        }
        // Skip if already registered with this exact token combination.
        if didRegister, lastRegisteredLiveActivityToken == liveActivityStartToken {
            return
        }
        didRegister = true
        lastRegisteredLiveActivityToken = liveActivityStartToken
        logger.info(
            "Registering device: token=\(token.prefix(8))... liveActivity=\(self.liveActivityStartToken.map { String($0.prefix(8)) + "..." } ?? "none")"
        )
        do {
            _ = try await apiClient.registerDevice(
                RegisterDevice(deviceToken: token, liveActivityStartToken: liveActivityStartToken)
            )
            logger.info("Device token registered successfully")
        } catch {
            didRegister = false
            logger.error("Failed to register device token: \(error)")
        }
    }

    /// Update the Live Activity push-to-start token and re-register. Called by
    /// `LiveActivityCoordinator` whenever ActivityKit emits a new token.
    func updateLiveActivityStartToken(_ token: String) {
        guard liveActivityStartToken != token else { return }
        liveActivityStartToken = token
        Task { await sendRegistrationIfReady() }
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

    // MARK: - UNUserNotificationCenterDelegate

    func userNotificationCenter(
        _: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        let type = notification.request.content.userInfo["type"] as? String ?? "nil"
        deepLinkLogger.info("willPresent (foreground notification) type=\(type)")
        completionHandler([.banner, .list, .sound, .badge])
    }

    func userNotificationCenter(
        _: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        let keys = userInfo.keys.compactMap { $0 as? String }.sorted().joined(separator: ",")
        deepLinkLogger.info("didReceive tap response — actionIdentifier=\(response.actionIdentifier) userInfo keys: [\(keys)]")
        routeTap(userInfo: userInfo)
        completionHandler()
    }

    private func routeTap(userInfo: [AnyHashable: Any]) {
        let type = userInfo["type"] as? String
        deepLinkLogger.info("routeTap type=\(type ?? "nil") navBound=\(self.navigationManager != nil)")

        guard let nav = navigationManager else {
            pendingUserInfo = userInfo
            deepLinkLogger.info("routeTap: NavigationManager not bound yet — caching userInfo for replay on bind()")
            return
        }

        switch type {
            case "briefing", "briefing-podcast-ready":
                guard let briefingId = userInfo["briefingId"] as? String else {
                    deepLinkLogger.warning("routeTap: \(type ?? "?") missing briefingId — userInfo=\(String(describing: userInfo))")
                    return
                }
                deepLinkLogger.info("routeTap → openDeepLink(.briefing(id: \(briefingId)))")
                nav.openDeepLink(.briefing(id: briefingId))

            case "audio-ready":
                guard let audioId = userInfo["audioId"] as? String else {
                    deepLinkLogger.warning("routeTap: audio-ready missing audioId — userInfo=\(String(describing: userInfo))")
                    return
                }
                deepLinkLogger.info("routeTap → openDeepLink(.audio(id: \(audioId)))")
                nav.openDeepLink(.audio(id: audioId))

            case "assistant_message", "confirmation", "question":
                let sessionId = (userInfo["sessionId"] as? String) ?? (userInfo["chatSessionId"] as? String)
                guard let sessionId else {
                    deepLinkLogger.warning("routeTap: \(type ?? "?") missing sessionId/chatSessionId — userInfo=\(String(describing: userInfo))")
                    return
                }
                if let taskId = userInfo["taskId"] as? String {
                    deepLinkLogger.info("routeTap → openDeepLink(.taskChatSession(taskId=\(taskId), sessionId=\(sessionId)))")
                    nav.openDeepLink(.taskChatSession(taskId: taskId, sessionId: sessionId))
                } else {
                    deepLinkLogger.info("routeTap → openDeepLink(.standaloneChatSession(id=\(sessionId)))")
                    nav.openDeepLink(.standaloneChatSession(id: sessionId))
                }

            default:
                deepLinkLogger.warning("routeTap: unhandled type=\(type ?? "nil") — userInfo=\(String(describing: userInfo))")
        }
    }
}
