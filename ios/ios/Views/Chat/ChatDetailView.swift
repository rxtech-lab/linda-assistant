import AssistantCore
import os
import SwiftUI

private let logger = Logger(subsystem: "lindaAssistant", category: "ChatDetailView")

struct ChatDetailView: View {
    let sessionId: String
    @Environment(AuthManager.self) private var authManager
    @Environment(EventManager.self) private var eventManager
    @State private var viewModel = ChatDetailViewModel()
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
            ZStack {
                // Loading view
                if viewModel.isLoading {
                    MessagesLoadingView()
                        .transition(.opacity.combined(with: .scale(scale: 0.98)))
                }

                // Content view
                if !viewModel.isLoading {
                    ScrollViewReader { proxy in
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: 12) {
                                MessageList(
                                    messages: viewModel.displayMessages,
                                    assigneeName: viewModel.assigneeName,
                                    streamingText: viewModel.streamHandler?.isStreaming == true ? viewModel
                                        .streamHandler?.streamedText : nil,
                                    streamingToolCalls: viewModel.streamHandler?.toolCalls ?? [],
                                    showPendingIndicator: showPendingIndicator,
                                    onConfirmationTap: {
                                        logger.info("onConfirmationTap: pendingConfirmation=\(viewModel.streamHandler?.pendingConfirmation != nil ? "set(\(viewModel.streamHandler!.pendingConfirmation!.toolName))" : "nil"), streamHandler=\(viewModel.streamHandler != nil ? "set" : "nil")")
                                        viewModel.showingConfirmation = true
                                    },
                                    onToolCallTap: { toolCall in
                                        selectedToolCall = toolCall
                                    }
                                )
                            }
                            .padding()
                        }
                        .onChange(of: viewModel.displayMessages.count) {
                            proxy.scrollTo("bottomAnchor", anchor: .bottom)
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
                        .onAppear {
                            if !viewModel.displayMessages.isEmpty {
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                                    withAnimation(.easeOut(duration: 0.5)) {
                                        proxy.scrollTo("bottomAnchor", anchor: .bottom)
                                    }
                                }
                            }
                        }
                    }
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
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
                    await viewModel.sendMessage(text, sessionId: sessionId)
                }
            } onStop: {
                // Intentionally disabled for now.
            }
        }
        .navigationTitle(viewModel.session?.title ?? "Chat")
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
            .sheet(isPresented: $viewModel.showingConfirmation) {
                if let confirmation = viewModel.streamHandler?.pendingConfirmation {
                    let _ = logger.info("sheet: rendering ConfirmationSheetView for toolName=\(confirmation.toolName), id=\(confirmation.confirmationId)")
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
                    let _ = logger.warning("sheet: pendingConfirmation is nil! streamHandler=\(viewModel.streamHandler != nil ? "set" : "nil"), dismissing")
                    Color.clear.onAppear { viewModel.showingConfirmation = false }
                }
            }
            .sheet(item: $selectedToolCall) { toolCall in
                ToolCallDetailSheet(toolCall: toolCall)
            }
        #if os(iOS)
            .toolbar(.hidden, for: .tabBar)
        #endif
            .task {
                await viewModel.loadSession(
                    id: sessionId,
                    apiClient: apiClient,
                    authManager: authManager,
                    eventManager: eventManager
                )
            }
            .onDisappear {
                viewModel.disconnect()
            }
    }
}

#Preview("Loading State") {
    NavigationStack {
        ChatDetailView(sessionId: "preview-session")
            .environment(AuthManager())
            .environment(EventManager())
    }
}

#Preview("Loading View Only") {
    MessagesLoadingView()
}
