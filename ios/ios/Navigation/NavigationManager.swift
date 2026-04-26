import AssistantCore
import OSLog
import SwiftUI

private let deepLinkLogger = Logger(subsystem: "lindaAssistant", category: "DeepLink")

enum AppDestination: Hashable {
    case task(id: String)
    case chatSession(id: String)
    case email(id: String)
    case webhook(id: String)
    case assignee(id: String, name: String)
    case assigneeExtensions(assigneeId: String)
    case taskToolPermissions(taskId: String)
    case taskExtensions(taskId: String)
    case extensionDetail(extensionId: String, assigneeId: String?, taskId: String? = nil)
    case taskChatSessions(taskId: String)
    case extensionList
    case assigneeList
    case usage
    case history
    case historyDetail(TaskHistory)
    case assigneeHistory(assigneeId: String)
}

/// Navigation value used by deep-link entry points to push a briefing detail
/// without needing the full `Briefing` model. The briefings list view registers
/// a `.navigationDestination(for: BriefingDeepLink.self)` handler.
struct BriefingDeepLink: Hashable {
    let id: String
}

enum DeepLinkTarget: Sendable {
    case briefing(id: String)
    case task(id: String)
    case audio(id: String)
    case taskChatSession(taskId: String, sessionId: String)
    case standaloneChatSession(id: String)
}

@Observable
final class NavigationManager {
    var selectedTab: Tab = .briefings
    var showingTabs = false
    var briefingsPath = NavigationPath()
    var tasksPath = NavigationPath()
    var chatPath = NavigationPath()
    var inboxPath = NavigationPath()
    var settingsPath = NavigationPath()
    var pendingAudioId: String?
    enum Tab: String, CaseIterable {
        case briefings
        case tasks
        case inbox
        case settings

        var title: String {
            switch self {
                case .briefings: "Briefing"
                case .tasks: "Tasks"
                case .inbox: "Inbox"
                case .settings: "Settings"
            }
        }

        var icon: String {
            switch self {
                case .briefings: "newspaper"
                case .tasks: "checklist"
                case .inbox: "tray.fill"
                case .settings: "gearshape"
            }
        }
    }

    func resetCurrentTab() {
        switch selectedTab {
            case .briefings: briefingsPath = NavigationPath()
            case .tasks: tasksPath = NavigationPath()
            case .inbox: inboxPath = NavigationPath()
            case .settings: settingsPath = NavigationPath()
        }
    }

    func resetChatPath() {
        chatPath = NavigationPath()
    }

    func openDeepLink(_ target: DeepLinkTarget) {
        deepLinkLogger.info(
            "NavigationManager.openDeepLink START target=\(String(describing: target)) | before: tab=\(self.selectedTab.rawValue) showingTabs=\(self.showingTabs) briefingsPath=\(self.briefingsPath.count) tasksPath=\(self.tasksPath.count) pendingAudioId=\(self.pendingAudioId ?? "nil")"
        )
        switch target {
            case let .briefing(id):
                selectedTab = .briefings
                briefingsPath = NavigationPath()
                briefingsPath.append(BriefingDeepLink(id: id))
                // On iPhone, the tabbed UI lives inside a fullScreenCover gated by `showingTabs`.
                // Surface it so BriefingListView's NavigationStack is in the view tree to receive the push.
                showingTabs = true
            case let .task(id):
                selectedTab = .tasks
                tasksPath = NavigationPath()
                tasksPath.append(AppDestination.task(id: id))
                showingTabs = true
            case let .audio(id):
                pendingAudioId = id
            case let .taskChatSession(taskId, sessionId):
                selectedTab = .tasks
                tasksPath = NavigationPath()
                tasksPath.append(AppDestination.task(id: taskId))
                tasksPath.append(AppDestination.chatSession(id: sessionId))
                showingTabs = true
            case let .standaloneChatSession(id):
                selectedTab = .tasks
                tasksPath = NavigationPath()
                tasksPath.append(AppDestination.chatSession(id: id))
                showingTabs = true
        }
        deepLinkLogger.info(
            "NavigationManager.openDeepLink END | after: tab=\(self.selectedTab.rawValue) showingTabs=\(self.showingTabs) briefingsPath=\(self.briefingsPath.count) tasksPath=\(self.tasksPath.count) pendingAudioId=\(self.pendingAudioId ?? "nil")"
        )
    }
}
