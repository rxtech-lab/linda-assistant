#if DEBUG && os(iOS)
    import SwiftUI

    /// Self-contained preview harness for `NavigationManager.openDeepLink(_:)`.
    ///
    /// Renders a minimal tab + NavigationStack shell with stub destinations so you can
    /// tap the buttons at the top to simulate each notification type without standing up
    /// the full auth/API stack. The routing logic exercised here is identical to what
    /// `PushNotificationManager.routeTap` invokes when a real APNs payload arrives.
    private struct DeepLinkPreviewHarness: View {
        @State private var nav = NavigationManager()

        var body: some View {
            @Bindable var nav = nav

            TabView(selection: $nav.selectedTab) {
                NavigationStack(path: $nav.briefingsPath) {
                    Text("Briefings list (stub)")
                        .navigationTitle("Briefing")
                        .navigationDestination(for: BriefingDeepLink.self) { link in
                            stubDetail(title: "Briefing detail", subtitle: "id: \(link.id)")
                        }
                }
                .tabItem { Label("Briefings", systemImage: "newspaper") }
                .tag(NavigationManager.Tab.briefings)

                NavigationStack(path: $nav.tasksPath) {
                    Text("Tasks list (stub)")
                        .navigationTitle("Tasks")
                        .navigationDestination(for: AppDestination.self) { dest in
                            stubAppDestination(dest)
                        }
                }
                .tabItem { Label("Tasks", systemImage: "checklist") }
                .tag(NavigationManager.Tab.tasks)

                Text("Inbox (stub)")
                    .tabItem { Label("Inbox", systemImage: "tray.fill") }
                    .tag(NavigationManager.Tab.inbox)

                Text("Settings (stub)")
                    .tabItem { Label("Settings", systemImage: "gearshape") }
                    .tag(NavigationManager.Tab.settings)
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                controls(nav: nav)
            }
            // Stub modal presenter mirroring AudioViewerPresenter — avoids the real
            // sheet's environment dependencies (AuthManager, EventManager, APIClient).
            .fullScreenCover(
                isPresented: Binding(
                    get: { nav.pendingAudioId != nil },
                    set: { if !$0 { nav.pendingAudioId = nil } }
                )
            ) {
                NavigationStack {
                    stubDetail(title: "Audio viewer", subtitle: "id: \(nav.pendingAudioId ?? "")")
                        .navigationTitle("Audio")
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button("Done") { nav.pendingAudioId = nil }
                            }
                        }
                }
            }
            .overlay(alignment: .bottom) { stateReadout(nav: nav) }
        }

        @ViewBuilder
        private func controls(nav: NavigationManager) -> some View {
            VStack(spacing: 6) {
                Text("Simulate notification tap")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                HStack(spacing: 6) {
                    Button("Briefing") {
                        nav.openDeepLink(.briefing(id: "briefing-123"))
                    }
                    Button("Podcast") {
                        // briefing-podcast-ready routes through the same target as briefing
                        nav.openDeepLink(.briefing(id: "briefing-with-podcast"))
                    }
                    Button("Audio") {
                        nav.openDeepLink(.audio(id: "audio-456"))
                    }
                }
                HStack(spacing: 6) {
                    Button("Task chat") {
                        nav.openDeepLink(.taskChatSession(taskId: "task-789", sessionId: "session-abc"))
                    }
                    Button("Standalone chat") {
                        nav.openDeepLink(.standaloneChatSession(id: "session-xyz"))
                    }
                    Button("Reset", role: .destructive) {
                        nav.briefingsPath = NavigationPath()
                        nav.tasksPath = NavigationPath()
                        nav.pendingAudioId = nil
                        nav.selectedTab = .briefings
                    }
                }
            }
            .font(.caption)
            .buttonStyle(.bordered)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity)
            .background(.ultraThinMaterial)
        }

        @ViewBuilder
        private func stubDetail(title: String, subtitle: String) -> some View {
            VStack(spacing: 12) {
                Image(systemName: "doc.text.magnifyingglass")
                    .font(.system(size: 48))
                    .foregroundStyle(.tint)
                Text(title).font(.title2.bold())
                Text(subtitle).font(.callout).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(.systemBackground))
        }

        @ViewBuilder
        private func stubAppDestination(_ dest: AppDestination) -> some View {
            switch dest {
                case let .task(id):
                    stubDetail(title: "Task detail", subtitle: "id: \(id)")
                        .navigationTitle("Task")
                case let .chatSession(id):
                    stubDetail(title: "Chat session", subtitle: "id: \(id)")
                        .navigationTitle("Chat")
                default:
                    stubDetail(title: "Other destination", subtitle: String(describing: dest))
            }
        }

        @ViewBuilder
        private func stateReadout(nav: NavigationManager) -> some View {
            VStack(alignment: .leading, spacing: 2) {
                Text("tab: \(nav.selectedTab.rawValue)")
                Text("briefingsPath: \(nav.briefingsPath.count)")
                Text("tasksPath: \(nav.tasksPath.count)")
                Text("pendingAudioId: \(nav.pendingAudioId ?? "nil")")
            }
            .font(.caption2.monospaced())
            .padding(8)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 8))
            .padding(8)
        }
    }

    #Preview("Deep link routing") {
        DeepLinkPreviewHarness()
    }
#endif
