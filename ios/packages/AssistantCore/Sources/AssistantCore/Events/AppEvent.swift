import Foundation

public enum AppEvent: Sendable {
    case taskCreated(LindaTask)
    case taskUpdated(LindaTask)
    case taskDeleted(String)
    case emailUpdated(Email)
    case emailDeleted(String)
    case webhookUpdated(Webhook)
    case webhookDeleted(String)
    case assigneeCreated(Assignee)
    case assigneeUpdated(Assignee)
    case assigneeDeleted(String)
    case chatSessionCreated(ChatSession)
    case chatSessionDeleted(String)
    case briefingCreated(Briefing)
    case briefingUpdated(Briefing)
    case briefingDeleted(String)
    case briefingPodcastReady(briefingId: String, podcastUrl: String)
    case extensionCreated(Extension)
    case extensionDeleted(String)
    case assigneeExtensionUpdated(String, String) // assigneeId, extensionId
    case taskExtensionUpdated(String, String) // taskId, extensionId
    case documentDeleted(String)
    case audioCreated(Audio)
    case audioDeleted(String)
    case audioReady(audioId: String, audioUrl: String)
    case confirmationResolved(String, String)
    case questionAnswered(String, String)
    case locationResolved(String, String)
    case uploadResolved(String, String)
    case streamContentUpdated
    case sharePending
    case openBriefingRequested(id: String)
    case openTaskRequested(id: String)
    case error(message: String)
}
