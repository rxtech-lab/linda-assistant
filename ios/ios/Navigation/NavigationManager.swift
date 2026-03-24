import SwiftUI

enum AppDestination: Hashable {
    case task(id: String)
    case chatSession(id: String)
    case email(id: String)
    case assignee(id: String, name: String)
    case assigneeExtensions(assigneeId: String)
    case taskToolPermissions(taskId: String)
    case taskExtensions(taskId: String)
    case extensionDetail(extensionId: String, assigneeId: String?, taskId: String? = nil)
    case extensionList
    case assigneeList
    case usage
}

@Observable
final class NavigationManager {
    var selectedTab: Tab = .briefings
    var showingTabs = false
    var briefingsPath = NavigationPath()
    var tasksPath = NavigationPath()
    var chatPath = NavigationPath()
    var emailsPath = NavigationPath()
    var settingsPath = NavigationPath()
    enum Tab: String, CaseIterable {
        case briefings
        case tasks
        case emails
        case settings

        var title: String {
            switch self {
                case .briefings: "Briefing"
                case .tasks: "Tasks"
                case .emails: "Email"
                case .settings: "Settings"
            }
        }

        var icon: String {
            switch self {
                case .briefings: "newspaper"
                case .tasks: "checklist"
                case .emails: "envelope"
                case .settings: "gearshape"
            }
        }
    }

    func resetCurrentTab() {
        switch selectedTab {
            case .briefings: briefingsPath = NavigationPath()
            case .tasks: tasksPath = NavigationPath()
            case .emails: emailsPath = NavigationPath()
            case .settings: settingsPath = NavigationPath()
        }
    }

    func resetChatPath() {
        chatPath = NavigationPath()
    }
}
