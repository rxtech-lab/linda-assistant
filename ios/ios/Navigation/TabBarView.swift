import SwiftUI

struct TabBarView: View {
    @Environment(NavigationManager.self) private var navigationManager

    var body: some View {
        @Bindable var nav = navigationManager

        TabView(selection: $nav.selectedTab) {
            Tab("Tasks", systemImage: "checklist", value: .tasks) {
                NavigationStack(path: $nav.tasksPath) {
                    TaskListView()
                }
            }

            Tab("Email", systemImage: "envelope", value: .emails) {
                NavigationStack(path: $nav.emailsPath) {
                    EmailListView()
                }
            }

            Tab("Assignees", systemImage: "person.2", value: .assignees) {
                NavigationStack(path: $nav.assigneesPath) {
                    AssigneeListView()
                }
            }

            Tab("Settings", systemImage: "gearshape", value: .settings) {
                NavigationStack(path: $nav.settingsPath) {
                    SettingsView()
                }
            }
        }
    }
}
