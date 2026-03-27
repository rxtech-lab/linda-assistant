import AssistantCore
import SwiftUI

struct InboxListView: View {
    @Environment(AuthManager.self) private var authManager
    @Environment(EventManager.self) private var eventManager
    @State private var viewModel = InboxListViewModel()

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    private var chipBackgroundColor: Color {
        #if os(macOS)
            return Color(nsColor: .systemGray)
        #else
            return Color(.systemGray5)
        #endif
    }

    var body: some View {
        List {
            Section {
                if let error = viewModel.error, viewModel.items.isEmpty {
                    ErrorRetryView(message: error) {
                        Task { await viewModel.loadItems(apiClient: apiClient) }
                    }
                    .listRowSeparator(.hidden)
                } else if viewModel.items.isEmpty, !viewModel.isLoading {
                    EmptyStateView(
                        icon: viewModel.selectedCategory?.iconName ?? "tray",
                        title: "No Items",
                        message: emptyMessage
                    )
                    .listRowSeparator(.hidden)
                } else {
                    ForEach(viewModel.items) { item in
                        let showTag = viewModel.selectedCategory == nil
                        switch item {
                            case let .email(email):
                                NavigationLink(value: AppDestination.email(id: email.id)) {
                                    EmailRowView(email: email, showCategory: showTag)
                                }
                            case let .webhook(webhook):
                                NavigationLink(value: AppDestination.webhook(id: webhook.id)) {
                                    WebhookRowView(webhook: webhook, showCategory: showTag)
                                }
                        }
                    }
                    .onDelete { offsets in
                        Task { await handleDelete(at: offsets) }
                    }
                }
            } header: {
                categoryFilterBar()
                    .padding(.vertical, 4)
                    .textCase(nil)
            }
        }
        .listStyle(.plain)
        .overlay {
            if viewModel.isLoading || viewModel.isSwitchingCategory {
                VStack(spacing: 8) {
                    ProgressView()
                    Text("Loading...")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(20)
                .background(.ultraThinMaterial)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .transition(.opacity)
            }
        }
        .refreshable {
            await viewModel.loadItems(apiClient: apiClient)
        }
        .navigationTitle("Inbox")
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
                case .extensionList: ExtensionListView()
                case .assigneeList: AssigneeListView()
                case .usage: UsageView()
                case .history: HistoryListView()
                case let .historyDetail(history): HistoryDetailView(history: history)
                case let .assigneeHistory(assigneeId): HistoryListView(assigneeId: assigneeId)
            }
        }
        .task {
            await viewModel.loadItems(apiClient: apiClient)
        }
        .task {
            await viewModel.subscribeToEvents(eventManager: eventManager, apiClient: apiClient)
        }
    }

    private var emptyMessage: String {
        switch viewModel.selectedCategory {
            case .email: "No emails found."
            case .webhook: "No webhooks found."
            case nil: "Incoming emails and webhooks will appear here."
        }
    }

    private func handleDelete(at offsets: IndexSet) async {
        let displayedItems = viewModel.items
        for index in offsets {
            let item = displayedItems[index]
            switch item {
                case let .email(email):
                    if let emailIndex = viewModel.emails.firstIndex(where: { $0.id == email.id }) {
                        await viewModel.deleteEmail(
                            at: IndexSet(integer: emailIndex),
                            from: viewModel.emails,
                            apiClient: apiClient,
                            eventManager: eventManager
                        )
                    }
                case let .webhook(webhook):
                    if let webhookIndex = viewModel.webhooks.firstIndex(where: { $0.id == webhook.id }) {
                        await viewModel.deleteWebhook(
                            at: IndexSet(integer: webhookIndex),
                            from: viewModel.webhooks,
                            apiClient: apiClient,
                            eventManager: eventManager
                        )
                    }
            }
        }
    }

    private func categoryFilterBar() -> some View {
        let allCategories: [(String, String, InboxCategory?)] = [
            ("All", "tray.full", nil),
        ] + InboxCategory.allCases.map { ($0.displayName, $0.iconName, Optional($0)) }
        let totalParts = CGFloat(allCategories.count) + 1
        let spacing: CGFloat = 8

        return GeometryReader { geo in
            let totalSpacing = spacing * CGFloat(allCategories.count - 1)
            let availableWidth = geo.size.width - totalSpacing
            let unitWidth = availableWidth / totalParts

            HStack(spacing: spacing) {
                ForEach(Array(allCategories.enumerated()), id: \.offset) { _, item in
                    let isSelected = viewModel.selectedCategory == item.2
                    let chipWidth = isSelected ? unitWidth * 2 : unitWidth

                    Button {
                        Task { await viewModel.selectCategory(item.2, apiClient: apiClient) }
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: item.1)
                                .font(.subheadline)
                            if isSelected {
                                Text(item.0)
                                    .font(.subheadline)
                                    .fontWeight(.semibold)
                                    .transition(.move(edge: .leading).combined(with: .opacity))
                            }
                        }
                        .frame(width: chipWidth)
                        .padding(.vertical, 7)
                        .background(isSelected ? Color.accentColor : chipBackgroundColor)
                        .foregroundStyle(isSelected ? .white : .primary)
                        .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .frame(height: 34)
    }
}
