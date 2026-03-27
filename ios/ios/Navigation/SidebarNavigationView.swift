import SwiftUI

struct SidebarNavigationView: View {
    @Environment(NavigationManager.self) private var navigationManager

    private enum SidebarItem: String, CaseIterable {
        case chat
        case tasks
        case inbox
        case settings

        var title: String {
            switch self {
                case .chat: "Chat"
                case .tasks: "Tasks"
                case .inbox: "Inbox"
                case .settings: "Settings"
            }
        }

        var icon: String {
            switch self {
                case .chat: "bubble.left.and.bubble.right"
                case .tasks: "checklist"
                case .inbox: "tray.fill"
                case .settings: "gearshape"
            }
        }
    }

    @State private var selectedItem: SidebarItem = .chat

    var body: some View {
        @Bindable var nav = navigationManager

        NavigationSplitView {
            List {
                ForEach(SidebarItem.allCases, id: \.self) { item in
                    Button {
                        selectedItem = item
                    } label: {
                        Label(item.title, systemImage: item.icon)
                    }
                    .buttonStyle(.plain)
                    .listItemTint(selectedItem == item ? .accentColor : .primary)
                }
            }
            .frame(minWidth: 200)
            .navigationTitle("Linda")
            .listStyle(.sidebar)
        } detail: {
            switch selectedItem {
                case .chat:
                    NavigationStack(path: $nav.chatPath) {
                        ChatTabView()
                    }
                case .tasks:
                    NavigationStack(path: $nav.tasksPath) {
                        TaskListView()
                    }
                case .inbox:
                    NavigationStack(path: $nav.inboxPath) {
                        InboxListView()
                    }
                case .settings:
                    NavigationStack(path: $nav.settingsPath) {
                        SettingsView()
                    }
            }
        }
    }
}
