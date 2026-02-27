import AssistantCore
import os
import SwiftUI

private let logger = Logger(subsystem: "lindaAssistant", category: "StandaloneChatView")

struct ChatTabView: View {
    @Environment(AuthManager.self) private var authManager
    @Environment(EventManager.self) private var eventManager
    @Environment(NavigationManager.self) private var navigationManager
    @State private var viewModel = ChatTabViewModel()
    @State private var selectedDocumentItem: DocumentSheetItem?

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
                        await viewModel.sendMessage(
                            text,
                            apiClient: apiClient,
                            authManager: authManager,
                            eventManager: eventManager
                        )
                    },
                    onStop: { await viewModel.stopStream() }
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
        .sheet(isPresented: $viewModel.showingAssigneeSheet) {
            ChatOptionsSheet(
                assignees: viewModel.assignees,
                selectedAssigneeId: viewModel.selectedAssignee?.id,
                documents: viewModel.documents,
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
                onSelectDocument: { doc in
                    viewModel.showingAssigneeSheet = false
                    selectedDocumentItem = DocumentSheetItem(id: doc.id, title: doc.title)
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
        .sheet(item: $selectedDocumentItem) { item in
            DocumentViewerSheet(documentId: item.id, initialTitle: item.title)
        }
        .task {
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
