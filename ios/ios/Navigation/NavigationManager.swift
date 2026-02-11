import SwiftUI

enum AppDestination: Hashable {
    case task(id: String)
    case chatSession(id: String)
    case email(id: String)
    case assignee(id: String, name: String)
}

@Observable
final class NavigationManager {
    var selectedTab: Tab = .tasks
    var tasksPath = NavigationPath()
    var chatPath = NavigationPath()
    var emailsPath = NavigationPath()
    var assigneesPath = NavigationPath()
    var settingsPath = NavigationPath()

    enum Tab: String, CaseIterable {
        case tasks
        case chat
        case emails
        case assignees
        case settings

        var title: String {
            switch self {
                case .tasks: "Tasks"
                case .chat: "Chat"
                case .emails: "Email"
                case .assignees: "Assignees"
                case .settings: "Settings"
            }
        }

        var icon: String {
            switch self {
                case .tasks: "checklist"
                case .chat: "bubble.left.and.bubble.right"
                case .emails: "envelope"
                case .assignees: "person.2"
                case .settings: "gearshape"
            }
        }
    }

    func resetCurrentTab() {
        switch selectedTab {
            case .tasks: tasksPath = NavigationPath()
            case .chat: chatPath = NavigationPath()
            case .emails: emailsPath = NavigationPath()
            case .assignees: assigneesPath = NavigationPath()
            case .settings: settingsPath = NavigationPath()
        }
    }
}
