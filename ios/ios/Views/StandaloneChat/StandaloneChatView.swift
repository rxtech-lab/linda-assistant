import AssistantCore
import os
import SwiftUI

private let logger = Logger(subsystem: "lindaAssistant", category: "StandaloneChatView")

struct ChatTabView: View {
    @Environment(AuthManager.self) private var authManager
    @Environment(EventManager.self) private var eventManager
    @Environment(NavigationManager.self) private var navigationManager
    @State private var viewModel = ChatTabViewModel()
    @State private var messageText = ""
    @State private var selectedToolCall: ToolCallInfo?
    @State private var errorDismissTask: Task<Void, Never>?

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    private var showPendingIndicator: Bool {
        guard let handler = viewModel.streamHandler,
              handler.isStreaming,
              handler.streamedText.isEmpty,
              handler.toolCalls.isEmpty,
              handler.pendingConfirmation == nil,
              handler.error == nil
        else { return false }
        return true
    }

    var body: some View {
        VStack(spacing: 0) {
            if viewModel.assignees.isEmpty, !viewModel.isLoading {
                emptyAssigneesView
            } else {
                ZStack {
                    if viewModel.isLoading {
                        MessagesLoadingView()
                            .transition(.opacity.combined(with: .scale(scale: 0.98)))
                    }

                    if !viewModel.isLoading {
                        ScrollViewReader { proxy in
                            ScrollView {
                                LazyVStack(alignment: .leading, spacing: 12) {
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

                                    MessageList(
                                        messages: viewModel.displayMessages,
                                        assigneeName: viewModel.selectedAssignee?.name,
                                        streamingText: viewModel.streamHandler?.isStreaming == true
                                            ? viewModel.streamHandler?.streamedText : nil,
                                        streamingToolCalls: viewModel.streamHandler?.toolCalls ?? [],
                                        showPendingIndicator: showPendingIndicator,
                                        onConfirmationTap: {
                                            logger.info("onConfirmationTap: pendingConfirmation=\(viewModel.streamHandler?.pendingConfirmation != nil ? "set" : "nil"), streamHandler=\(viewModel.streamHandler != nil ? "set" : "nil")")
                                            viewModel.showingConfirmation = true
                                        },
                                        onToolCallTap: { toolCall in
                                            selectedToolCall = toolCall
                                        }
                                    )
                                }
                                .padding()
                            }
                            .onAppear {
                                if !viewModel.displayMessages.isEmpty {
                                    logger
                                        .debug(
                                            "ScrollView appeared with \(viewModel.displayMessages.count) messages, scrolling to bottom"
                                        )
                                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                                        withAnimation(.easeOut(duration: 0.5)) {
                                            proxy.scrollTo("bottomAnchor", anchor: .bottom)
                                        }
                                        logger.debug("Scroll to bottom executed")
                                    }
                                }
                            }
                            .onChange(of: viewModel.streamHandler?.streamedText) {
                                proxy.scrollTo("bottomAnchor", anchor: .bottom)
                            }
                            .onChange(of: viewModel.streamHandler?.toolCalls.count) {
                                proxy.scrollTo("bottomAnchor", anchor: .bottom)
                            }
                            .onChange(of: viewModel.streamHandler?.isStreaming) {
                                proxy.scrollTo("bottomAnchor", anchor: .bottom)
                            }
                            .onChange(of: viewModel.streamHandler?.pendingConfirmation?.toolCallId) {
                                if viewModel.streamHandler?.pendingConfirmation != nil {
                                    viewModel.showingConfirmation = true
                                }
                            }
                        }
                        .transition(.opacity)
                    }
                }
                .animation(.easeInOut(duration: 0.5), value: viewModel.isLoading)
                .overlay(alignment: .top) {
                    if let errorMessage = viewModel.displayError {
                        ErrorBannerView(message: errorMessage) {
                            withAnimation(.easeInOut(duration: 0.3)) {
                                viewModel.clearError()
                            }
                        }
                    }
                }
                .animation(.easeInOut(duration: 0.3), value: viewModel.displayError != nil)
                .onChange(of: viewModel.displayError) {
                    errorDismissTask?.cancel()
                    if viewModel.displayError != nil {
                        errorDismissTask = Task {
                            try? await Task.sleep(for: .seconds(6))
                            guard !Task.isCancelled else { return }
                            withAnimation(.easeInOut(duration: 0.3)) {
                                viewModel.clearError()
                            }
                        }
                    }
                }

                Divider()

                MessageInput(
                    text: $messageText,
                    isStreaming: viewModel.streamHandler?.isStreaming == true
                ) { text in
                    Task {
                        await viewModel.sendMessage(
                            text,
                            apiClient: apiClient,
                            authManager: authManager,
                            eventManager: eventManager
                        )
                    }
                } onStop: {
                    // Intentionally disabled for now.
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
        .sheet(isPresented: $viewModel.showingConfirmation) {
            if let confirmation = viewModel.streamHandler?.pendingConfirmation {
                ConfirmationSheetView(
                    confirmation: confirmation,
                    onResolve: { action, alwaysAllow in
                        Task {
                            await viewModel.streamHandler?.resolveConfirmation(
                                confirmationId: confirmation.confirmationId,
                                action: action,
                                alwaysAllow: alwaysAllow
                            )
                        }
                        viewModel.showingConfirmation = false
                    }
                )
            } else {
                Color.clear.onAppear { viewModel.showingConfirmation = false }
            }
        }
        .sheet(item: $selectedToolCall) { toolCall in
            ToolCallDetailSheet(toolCall: toolCall)
        }
        .sheet(isPresented: $viewModel.showingAssigneeSheet) {
            ChatOptionsSheet(
                assignees: viewModel.assignees,
                selectedAssigneeId: viewModel.selectedAssignee?.id,
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
                onClearMessages: {
                    viewModel.showingAssigneeSheet = false
                    Task {
                        await viewModel.clearMessages(apiClient: apiClient)
                    }
                }
            )
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
