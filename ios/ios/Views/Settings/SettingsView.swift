import AssistantCore
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

    var body: some View {
        Form {
            if let user = authManager.currentUser {
                Section {
                    HStack(spacing: 12) {
                        CachedAsyncImage(url: user.image.flatMap { URL(string: $0) }) { image in
                            image.resizable().scaledToFill()
                        } placeholder: {
                            Image(systemName: "person.crop.circle.fill")
                                .resizable()
                                .foregroundStyle(.secondary)
                        }
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
                NavigationLink("Usage", value: AppDestination.usage)
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
        .navigationDestination(for: AppDestination.self) { destination in
            switch destination {
                case let .task(id): TaskDetailView(taskId: id)
                case let .chatSession(id): ChatDetailView(sessionId: id)
                case let .email(id): EmailDetailView(emailId: id)
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
            }
        }
    }
}
