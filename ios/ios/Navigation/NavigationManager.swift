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
    var showingTabs = false
    var tasksPath = NavigationPath()
    var chatPath = NavigationPath()
    var emailsPath = NavigationPath()
    enum Tab: String, CaseIterable {
        case tasks
        case emails
        case settings

        var title: String {
            switch self {
                case .tasks: "Tasks"
                case .emails: "Email"
                case .settings: "Settings"
            }
        }

        var icon: String {
            switch self {
                case .tasks: "checklist"
                case .emails: "envelope"
                case .settings: "gearshape"
            }
        }
    }

    func resetCurrentTab() {
        switch selectedTab {
            case .tasks: tasksPath = NavigationPath()
            case .emails: emailsPath = NavigationPath()
            case .settings: break
        }
    }

    func resetChatPath() {
        chatPath = NavigationPath()
    }
}
