import AssistantCore
import os
import SwiftUI

private let logger = Logger(subsystem: "lindaAssistant", category: "StandaloneChatView")

struct ChatTabView: View {
    @Environment(AuthManager.self) private var authManager
    @Environment(EventManager.self) private var eventManager
    @Environment(NavigationManager.self) private var navigationManager
    @Environment(PushNotificationManager.self) private var pushManager
    @State private var viewModel = ChatTabViewModel()
    @State private var canAutoLoadMore = false

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    var body: some View {
        VStack(spacing: 0) {
            if viewModel.assignees.isEmpty, !viewModel.isLoading {
                emptyAssigneesView
            } else {
                StreamableChatLayout(
                    messages: viewModel.displayMessages,
                    assigneeName: viewModel.selectedAssignee?.name,
                    isLoading: viewModel.isLoading,
                    streamHandler: viewModel.streamHandler,
                    displayError: viewModel.displayError,
                    onClearError: { viewModel.clearError() },
                    onSend: { text in
                        Task {
                            await viewModel.sendMessage(
                                text,
                                apiClient: apiClient,
                                authManager: authManager,
                                eventManager: eventManager
                            )
                        }
                    },
                    onStop: {
                        Task { await viewModel.stopStream() }
                    }
                ) {
                    // Load more indicator
                    if viewModel.hasMoreMessages {
                        HStack {
                            Spacer()
                            if viewModel.isLoadingMore {
                                ProgressView()
                                    .controlSize(.small)
                            } else {
                                Button("Load earlier messages") {
                                    Task {
                                        await viewModel.loadOlderMessages(apiClient: apiClient)
                                    }
                                }
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            }
                            Spacer()
                        }
                        .padding(.vertical, 8)
                        .onAppear {
                            guard canAutoLoadMore else { return }
                            Task {
                                await viewModel.loadOlderMessages(apiClient: apiClient)
                            }
                        }
                    }
                }
            }
        }
        .toolbar {
            ToolbarItem(placement: .principal) {
                if !viewModel.assignees.isEmpty {
                    Button {
                        #if os(iOS)
                            UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        #endif
                        viewModel.showingAssigneeSheet = true
                    } label: {
                        HStack(spacing: 4) {
                            Text(viewModel.selectedAssignee?.name ?? "Chat")
                                .font(.headline)
                            Image(systemName: "chevron.down")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(.secondary)
                        }
                    }
                    .accessibilityIdentifier("assignee-button")
                    #if os(iOS)
                        .buttonStyle(.plain)
                    #endif
                }
            }

            #if os(iOS)
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        navigationManager.showingTabs = true
                    } label: {
                        Image(systemName: "square.grid.2x2")
                    }
                }
            #endif
        }
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .onChange(of: viewModel.showingAssigneeSheet) { _, isShowing in
            if isShowing, let assignee = viewModel.selectedAssignee {
                Task {
                    async let docs: () = viewModel.loadDocuments(assigneeId: assignee.id, apiClient: apiClient)
                    async let slides: () = viewModel.loadSlideDecks(assigneeId: assignee.id, apiClient: apiClient)
                    _ = await (docs, slides)
                }
            }
        }
        .sheet(isPresented: $viewModel.showingAssigneeSheet) {
            ChatOptionsSheet(
                assignees: viewModel.assignees,
                selectedAssigneeId: viewModel.selectedAssignee?.id,
                documents: viewModel.documents,
                slideDecks: viewModel.slideDecks,
                onSelectAssignee: { assignee in
                    viewModel.showingAssigneeSheet = false
                    Task {
                        await viewModel.switchAssignee(
                            assignee,
                            apiClient: apiClient,
                            authManager: authManager,
                            eventManager: eventManager
                        )
                    }
                },
                onDeleteDocument: { doc in
                    Task {
                        await viewModel.deleteDocument(
                            id: doc.id,
                            apiClient: apiClient,
                            eventManager: eventManager
                        )
                    }
                },
                onClearMessages: {
                    viewModel.showingAssigneeSheet = false
                    Task {
                        await viewModel.clearMessages(apiClient: apiClient)
                    }
                }
            )
        }
        .task {
            viewModel.deviceToken = pushManager.deviceToken
            await viewModel.load(
                apiClient: apiClient,
                authManager: authManager,
                eventManager: eventManager
            )
        }
        .task {
            await viewModel.subscribeToEvents(eventManager: eventManager)
        }
        .onAppear {
            if viewModel.streamHandler != nil, viewModel.streamHandler?.isConnected == false {
                Task {
                    await viewModel.reconnectIfNeeded(apiClient: apiClient)
                }
            }
        }
        .onChange(of: viewModel.isLoading) { oldValue, newValue in
            if oldValue == true, newValue == false {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                    canAutoLoadMore = true
                }
            }
        }
        .onDisappear {
            viewModel.disconnect()
        }
    }

    private var emptyAssigneesView: some View {
        ContentUnavailableView {
            Label("No Assignees", systemImage: "person.2.slash")
        } description: {
            Text("Create an assignee first to start chatting.")
        }
    }
}
