import AssistantCore
import Kingfisher
import SwiftUI

private extension Bundle {
    var appVersion: String {
        infoDictionary?["CFBundleShortVersionString"] as? String ?? "–"
    }

    var buildNumber: String {
        infoDictionary?["CFBundleVersion"] as? String ?? "–"
    }
}

struct SettingsView: View {
    @Environment(AuthManager.self) private var authManager
    @State private var assignees: [Assignee] = []
    @State private var defaultEmailAssigneeId: String?
    @State private var isLoadingSettings = false

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    var body: some View {
        Form {
            if let user = authManager.currentUser {
                Section {
                    HStack(spacing: 12) {
                        KFImage(user.image.flatMap { URL(string: $0) })
                            .placeholder {
                                Image(systemName: "person.crop.circle.fill")
                                    .resizable()
                                    .foregroundStyle(.secondary)
                            }
                            .resizable()
                            .scaledToFill()
                        .frame(width: 48, height: 48)
                        .clipShape(Circle())

                        VStack(alignment: .leading, spacing: 2) {
                            if let name = user.name {
                                Text(name)
                                    .font(.headline)
                            }
                            if let email = user.email {
                                Text(email)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .padding(.vertical, 4)
                }
            }

            Section("General") {
                NavigationLink("Assistants", value: AppDestination.assigneeList)
                NavigationLink("Extensions", value: AppDestination.extensionList)
                NavigationLink("History", value: AppDestination.history)
                NavigationLink("Usage", value: AppDestination.usage)
            }

            Section("Email") {
                Picker("Default Email Agent", selection: $defaultEmailAssigneeId) {
                    Text("None").tag(String?.none)
                    ForEach(assignees, id: \.id) { assignee in
                        Text(assignee.name).tag(Optional(assignee.id))
                    }
                }
                .onChange(of: defaultEmailAssigneeId) { _, newValue in
                    Task { await saveDefaultEmailAgent(newValue) }
                }
            }

            Section("About") {
                LabeledContent("Version", value: Bundle.main.appVersion)
                LabeledContent("Build", value: Bundle.main.buildNumber)
            }

            Section {
                Button("Sign Out", role: .destructive) {
                    Task { await authManager.signOut() }
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Settings")
        .task {
            await loadSettings()
        }
        .navigationDestination(for: AppDestination.self) { destination in
            switch destination {
                case let .task(id): TaskDetailView(taskId: id)
                case let .chatSession(id): ChatDetailView(sessionId: id)
                case let .email(id): EmailDetailView(emailId: id)
                case let .webhook(id): WebhookDetailView(webhookId: id)
                case let .assignee(id, name): AssigneeDetailView(assigneeId: id, assigneeName: name)
                case let .assigneeExtensions(assigneeId): AssigneeExtensionListView(assigneeId: assigneeId)
                case let .taskToolPermissions(taskId): TaskToolPermissionsView(taskId: taskId)
                case let .taskExtensions(taskId): TaskExtensionListView(taskId: taskId)
                case let .extensionDetail(extensionId, assigneeId, taskId):
                    ExtensionDetailView(extensionId: extensionId, assigneeId: assigneeId, taskId: taskId)
                case let .taskChatSessions(taskId): ChatSessionListView(taskId: taskId)
                case .extensionList:
                    ExtensionListView()
                    #if os(iOS)
                        .toolbar(.hidden, for: .tabBar)
                    #endif
                case .assigneeList:
                    AssigneeListView()
                    #if os(iOS)
                        .toolbar(.hidden, for: .tabBar)
                    #endif
                case .usage: UsageView()
                case .history: HistoryListView()
                case let .historyDetail(history): HistoryDetailView(history: history)
                case let .assigneeHistory(assigneeId): HistoryListView(assigneeId: assigneeId)
            }
        }
    }

    private func loadSettings() async {
        do {
            async let fetchedAssignees = apiClient.listAssignees()
            async let fetchedSettings = apiClient.getUserSettings()
            assignees = try await fetchedAssignees.data
            let settings = try await fetchedSettings
            defaultEmailAssigneeId = settings.defaultEmailAssigneeId
        } catch {
            // Non-critical, settings will show defaults
        }
    }

    private func saveDefaultEmailAgent(_ assigneeId: String?) async {
        do {
            _ = try await apiClient.updateUserSettings(
                UpdateUserSettings(defaultEmailAssigneeId: assigneeId)
            )
        } catch {
            // Revert on failure would be ideal but keep simple for now
        }
    }
}
