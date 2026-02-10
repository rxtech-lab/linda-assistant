import AssistantCore
import SwiftUI

struct ChatDetailView: View {
    let sessionId: String
    @Environment(AuthManager.self) private var authManager
    @Environment(EventManager.self) private var eventManager
    @State private var viewModel = ChatDetailViewModel()
    @State private var messageText = ""

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
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        MessageList(
                            messages: viewModel.displayMessages,
                            assigneeName: viewModel.assigneeName,
                            streamingText: viewModel.streamHandler?.isStreaming == true ? viewModel.streamHandler?.streamedText : nil,
                            streamingToolCalls: viewModel.streamHandler?.toolCalls ?? [],
                            showPendingIndicator: showPendingIndicator
                        ) {
                            viewModel.showingConfirmation = true
                        }
                    }
                    .padding()
                }
                .onChange(of: viewModel.displayMessages.count) {
                    withAnimation {
                        proxy.scrollTo("bottomAnchor", anchor: .bottom)
                    }
                }
                .onChange(of: viewModel.streamHandler?.streamedText) {
                    proxy.scrollTo("bottomAnchor", anchor: .bottom)
                }
                .onChange(of: viewModel.streamHandler?.toolCalls.count) {
                    withAnimation {
                        proxy.scrollTo("bottomAnchor", anchor: .bottom)
                    }
                }
                .onChange(of: viewModel.streamHandler?.isStreaming) {
                    withAnimation {
                        proxy.scrollTo("bottomAnchor", anchor: .bottom)
                    }
                }
                .onChange(of: viewModel.streamHandler?.pendingConfirmation?.toolCallId) {
                    if viewModel.streamHandler?.pendingConfirmation != nil {
                        viewModel.showingConfirmation = true
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
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $viewModel.showingConfirmation) {
            if let confirmation = viewModel.streamHandler?.pendingConfirmation {
                ConfirmationSheetView(
                    confirmation: confirmation,
                    onResolve: { action in
                        Task {
                            await viewModel.streamHandler?.resolveConfirmation(
                                confirmationId: confirmation.confirmationId,
                                action: action
                            )
                        }
                        viewModel.showingConfirmation = false
                    }
                )
            }
        }
        .toolbar(.hidden, for: .tabBar)
        .task {
            await viewModel.loadSession(id: sessionId, apiClient: apiClient, authManager: authManager, eventManager: eventManager)
        }
        .onDisappear {
            viewModel.disconnect()
        }
    }
}
