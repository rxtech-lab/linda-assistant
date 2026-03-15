import AssistantCore
import os
import SwiftUI

private let logger = Logger(subsystem: "lindaAssistant", category: "ChatDetailView")

struct ChatDetailView: View {
    let sessionId: String
    @Environment(AuthManager.self) private var authManager
    @Environment(EventManager.self) private var eventManager
    @Environment(PushNotificationManager.self) private var pushManager
    @State private var viewModel = ChatDetailViewModel()

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    var body: some View {
        StreamableChatLayout(
            messages: viewModel.displayMessages,
            assigneeName: viewModel.assigneeName,
            isLoading: viewModel.isLoading,
            streamHandler: viewModel.streamHandler,
            displayError: viewModel.displayError,
            onClearError: { viewModel.clearError() },
            onSend: { text in
                Task {
                    await viewModel.sendMessage(text, sessionId: sessionId)
                }
            },
            onStop: {
                Task { await viewModel.stopStream(sessionId: sessionId) }
            }
        )
        .navigationTitle(viewModel.session?.title ?? "Chat")
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
        #if os(iOS)
        .toolbar(.hidden, for: .tabBar)
        #endif
        .task {
            await viewModel.loadSession(
                id: sessionId,
                apiClient: apiClient,
                authManager: authManager,
                eventManager: eventManager,
                deviceToken: pushManager.deviceToken
            )
        }
        .onAppear {
            if viewModel.streamHandler != nil, viewModel.streamHandler?.isConnected == false {
                Task {
                    await viewModel.reconnectIfNeeded(
                        sessionId: sessionId,
                        apiClient: apiClient
                    )
                }
            }
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
