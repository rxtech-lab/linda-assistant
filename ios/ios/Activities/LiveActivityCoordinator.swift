#if canImport(ActivityKit) && os(iOS)
    import ActivityKit
    import AssistantCore
    import OSLog
    import SwiftUI

    private let logger = Logger(subsystem: "lindaAssistant", category: "LiveActivity")

    /// Owns the iOS side of the task Live Activity push lifecycle.
    ///
    /// On launch we observe two ActivityKit async streams and forward the tokens
    /// to the backend:
    ///
    /// 1. `Activity<LindaTaskAttributes>.pushToStartTokenUpdates` — the device-wide
    ///    push-to-start token (iOS 17.2+). Stored on the device record so the
    ///    backend can spawn an Activity remotely.
    /// 2. For each existing or newly-spawned `Activity<LindaTaskAttributes>`, its
    ///    own `pushTokenUpdates` — the per-activity update token, registered
    ///    keyed by `activityId` so the backend can target update/end pushes.
    @available(iOS 16.1, *)
    @Observable
    final class LiveActivityCoordinator: @unchecked Sendable {
        private weak var pushManager: PushNotificationManager?
        private var apiClient: APIClient?

        func bind(pushManager: PushNotificationManager, apiClient: APIClient) {
            self.pushManager = pushManager
            self.apiClient = apiClient
            startObserving()
        }

        private func startObserving() {
            // Push-to-start: device-wide token, iOS 17.2+
            if #available(iOS 17.2, *) {
                Task { [weak self] in
                    for await tokenData in Activity<LindaTaskAttributes>.pushToStartTokenUpdates {
                        let hex = tokenData.map { String(format: "%02x", $0) }.joined()
                        logger.info("pushToStart token: \(hex.prefix(8))...")
                        self?.pushManager?.updateLiveActivityStartToken(hex)
                    }
                }
            }

            // Per-activity tokens: re-attach to anything already running, then
            // pick up future activities as ActivityKit reports them.
            for activity in Activity<LindaTaskAttributes>.activities {
                observe(activity)
            }
            Task { [weak self] in
                for await activity in Activity<LindaTaskAttributes>.activityUpdates {
                    self?.observe(activity)
                }
            }
        }

        private func observe(_ activity: Activity<LindaTaskAttributes>) {
            logger.info("Observing activity id=\(activity.id) taskId=\(activity.attributes.taskId)")
            Task { [weak self] in
                for await tokenData in activity.pushTokenUpdates {
                    let hex = tokenData.map { String(format: "%02x", $0) }.joined()
                    await self?.registerActivityToken(activity: activity, hex: hex)
                }
            }
        }

        private func registerActivityToken(
            activity: Activity<LindaTaskAttributes>,
            hex: String
        ) async {
            guard let apiClient else { return }
            do {
                _ = try await apiClient.registerLiveActivityToken(
                    RegisterLiveActivityToken(
                        activityId: activity.id,
                        taskId: activity.attributes.taskId,
                        token: hex
                    )
                )
                logger.info("Registered activity token id=\(activity.id) hex=\(hex.prefix(8))...")
            } catch {
                logger.error("Failed to register activity token: \(error)")
            }
        }
    }
#endif
