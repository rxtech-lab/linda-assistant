import SwiftUI

#if os(iOS)
    struct TabBarView: View {
        @Environment(NavigationManager.self) private var navigationManager

        var body: some View {
            @Bindable var nav = navigationManager

            TabView(selection: $nav.selectedTab) {
                Tab("Briefing", systemImage: "newspaper", value: .briefings) {
                    NavigationStack(path: $nav.briefingsPath) {
                        BriefingListView()
                            .toolbar {
                                ToolbarItem(placement: .topBarLeading) {
                                    chatButton
                                }
                            }
                    }
                }
                .accessibilityIdentifier("briefings-tab")

                Tab("Tasks", systemImage: "checklist", value: .tasks) {
                    NavigationStack(path: $nav.tasksPath) {
                        TaskListView()
                            .toolbar {
                                ToolbarItem(placement: .topBarLeading) {
                                    chatButton
                                }
                            }
                    }
                }
                .accessibilityIdentifier("tasks-tab")

                Tab("Email", systemImage: "envelope", value: .emails) {
                    NavigationStack(path: $nav.emailsPath) {
                        EmailListView()
                            .toolbar {
                                ToolbarItem(placement: .topBarLeading) {
                                    chatButton
                                }
                            }
                    }
                }
                .accessibilityIdentifier("emails-tab")

                Tab("Settings", systemImage: "gearshape", value: .settings) {
                    NavigationStack {
                        SettingsView()
                            .toolbar {
                                ToolbarItem(placement: .topBarLeading) {
                                    chatButton
                                }
                            }
                    }
                }
                .accessibilityIdentifier("settings-tab")
            }
            .tabBarMinimizeBehavior(.onScrollUp)
        }

        private var chatButton: some View {
            Button {
                navigationManager.showingTabs = false
            } label: {
                Image(systemName: "xmark")
            }
        }
    }
#endif
