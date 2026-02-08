import SwiftUI

@Observable
final class NavigationManager {
    var selectedTab: Tab = .tasks
    var tasksPath = NavigationPath()
    var emailsPath = NavigationPath()
    var assigneesPath = NavigationPath()

    enum Tab: String, CaseIterable {
        case tasks
        case emails
        case assignees

        var title: String {
            switch self {
            case .tasks: "Tasks"
            case .emails: "Email"
            case .assignees: "Assignees"
            }
        }

        var icon: String {
            switch self {
            case .tasks: "checklist"
            case .emails: "envelope"
            case .assignees: "person.2"
            }
        }
    }

    func resetCurrentTab() {
        switch selectedTab {
        case .tasks: tasksPath = NavigationPath()
        case .emails: emailsPath = NavigationPath()
        case .assignees: assigneesPath = NavigationPath()
        }
    }
}
