import Foundation

public enum AppEvent: Sendable {
    case taskCreated(LindaTask)
    case taskUpdated(LindaTask)
    case taskDeleted(String)
    case emailUpdated(Email)
    case emailDeleted(String)
    case assigneeCreated(Assignee)
    case assigneeUpdated(Assignee)
    case assigneeDeleted(String)
    case chatSessionCreated(ChatSession)
    case chatSessionDeleted(String)
    case documentDeleted(String)
    case confirmationResolved(String, String)
    case streamContentUpdated
    case error(message: String)
}
