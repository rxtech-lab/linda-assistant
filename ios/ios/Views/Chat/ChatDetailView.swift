import SwiftUI
import AssistantCore

struct ChatDetailView: View {
    let sessionId: String
    @Environment(AuthManager.self) private var authManager
    @Environment(EventManager.self) private var eventManager
    @State private var viewModel = ChatDetailViewModel()
    @State private var messageText = ""
    @State private var showingConfirmation = false

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    var body: some View {
        VStack(spacing: 0) {
            // Messages
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(viewModel.displayMessages) { msg in
                            MessageBubble(message: msg)
                                .id(msg.id)
                        }

                        // Streaming text
                        if !viewModel.streamHandler.streamedText.isEmpty && viewModel.streamHandler.isStreaming {
                            MessageBubble(message: DisplayMessage(
                                id: "streaming",
                                role: .assistant,
                                content: viewModel.streamHandler.streamedText,
                                isStreaming: true
                            ))
                            .id("streaming")
                        }

                        // Tool calls
                        ForEach(viewModel.streamHandler.toolCalls) { toolCall in
                            ToolCallBadge(toolCall: toolCall)
                        }

                        // Pending confirmation
                        if let confirmation = viewModel.streamHandler.pendingConfirmation {
                            ConfirmationCardView(
                                confirmation: confirmation,
                                onTap: { showingConfirmation = true }
                            )
                        }
                    }
                    .padding()
                }
                .onChange(of: viewModel.displayMessages.count) {
                    withAnimation {
                        proxy.scrollTo(viewModel.displayMessages.last?.id ?? "streaming", anchor: .bottom)
                    }
                }
                .onChange(of: viewModel.streamHandler.streamedText) {
                    proxy.scrollTo("streaming", anchor: .bottom)
                }
            }

            Divider()

            // Input bar
            HStack(spacing: 12) {
                TextField("Type a message...", text: $messageText, axis: .vertical)
                    .lineLimit(1...5)
                    .textFieldStyle(.plain)

                Button {
                    let text = messageText.trimmingCharacters(in: .whitespaces)
                    guard !text.isEmpty else { return }
                    messageText = ""
                    Task {
                        await viewModel.sendMessage(text, sessionId: sessionId, apiClient: apiClient)
                    }
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title2)
                }
                .disabled(messageText.trimmingCharacters(in: .whitespaces).isEmpty || viewModel.streamHandler.isStreaming)
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
        }
        .navigationTitle(viewModel.session?.title ?? "Chat")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showingConfirmation) {
            if let confirmation = viewModel.streamHandler.pendingConfirmation {
                ConfirmationSheetView(
                    confirmation: confirmation,
                    onResolve: { action in
                        Task {
                            await viewModel.streamHandler.resolveConfirmation(
                                confirmationId: confirmation.confirmationId,
                                action: action
                            )
                        }
                        showingConfirmation = false
                    }
                )
            }
        }
        .task {
            await viewModel.loadSession(id: sessionId, apiClient: apiClient, authManager: authManager, eventManager: eventManager)
        }
    }
}

// MARK: - Display Message

struct DisplayMessage: Identifiable {
    let id: String
    let role: MessageRole
    let content: String
    var isStreaming = false

    enum MessageRole {
        case user, assistant, system
    }
}

// MARK: - Message Bubble

private struct MessageBubble: View {
    let message: DisplayMessage

    var body: some View {
        HStack {
            if message.role == .user { Spacer(minLength: 60) }

            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 4) {
                Text(message.role == .user ? "You" : "Linda")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)

                Text(message.content)
                    .padding(12)
                    .background(message.role == .user ? Color.accentColor.opacity(0.15) : Color(.systemGray6))
                    .clipShape(RoundedRectangle(cornerRadius: 16))
            }

            if message.role == .assistant { Spacer(minLength: 60) }
        }
    }
}

// MARK: - Tool Call Badge

private struct ToolCallBadge: View {
    let toolCall: ToolCallInfo

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: toolCall.status == .completed ? "checkmark.circle.fill" : "arrow.trianglehead.2.clockwise")
                .foregroundStyle(toolCall.status == .completed ? .green : .blue)

            VStack(alignment: .leading) {
                Text(toolCall.toolName)
                    .font(.caption.weight(.medium))
                if toolCall.status == .completed {
                    Text("Completed")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                } else {
                    Text("Running...")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(8)
        .background(.fill.tertiary)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}
