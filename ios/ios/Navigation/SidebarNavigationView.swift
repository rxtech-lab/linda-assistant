import SwiftUI

struct SidebarNavigationView: View {
    @Environment(NavigationManager.self) private var navigationManager

    var body: some View {
        @Bindable var nav = navigationManager

        NavigationSplitView {
            List {
                ForEach(NavigationManager.Tab.allCases, id: \.self) { tab in
                    Button {
                        nav.selectedTab = tab
                    } label: {
                        Label(tab.title, systemImage: tab.icon)
                    }
                    .listItemTint(nav.selectedTab == tab ? .accentColor : .primary)
                }
            }
            .navigationTitle("Linda")
            .listStyle(.sidebar)
        } detail: {
            switch navigationManager.selectedTab {
            case .tasks:
                NavigationStack(path: $nav.tasksPath) {
                    TaskListView()
                }
            case .emails:
                NavigationStack(path: $nav.emailsPath) {
                    EmailListView()
                }
            case .assignees:
                NavigationStack(path: $nav.assigneesPath) {
                    AssigneeListView()
                }
            }
        }
    }
}
