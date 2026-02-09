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

    var body: some View {
        VStack(spacing: 0) {
            // Messages
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(viewModel.displayMessages) { msg in
                            if !msg.content.isEmpty {
                                MessageBubble(message: msg)
                            }
                            // Historical tool call badges
                            ForEach(msg.toolCalls) { toolCall in
                                ToolCallBadge(toolCall: toolCall) {
                                    if toolCall.status == .pendingConfirmation {
                                        viewModel.showingConfirmation = true
                                    }
                                }
                            }
                        }

                        // Pending indicator (before any content arrives)
                        if let handler = viewModel.streamHandler,
                           handler.isStreaming,
                           handler.streamedText.isEmpty,
                           handler.toolCalls.isEmpty,
                           handler.pendingConfirmation == nil,
                           handler.error == nil
                        {
                            AssistantPendingIndicator()
                                .id("pendingIndicator")
                        }

                        // Streaming text
                        if let handler = viewModel.streamHandler, !handler.streamedText.isEmpty, handler.isStreaming {
                            MessageBubble(message: DisplayMessage(
                                id: "streaming",
                                role: .assistant,
                                content: handler.streamedText,
                                isStreaming: true
                            ))
                            .id("streaming")
                        }

                        // Active streaming tool calls
                        if let handler = viewModel.streamHandler {
                            ForEach(handler.toolCalls) { toolCall in
                                ToolCallBadge(toolCall: toolCall)
                            }
                        }

                        Spacer()
                            .frame(height: 30)
                            .id("bottomAnchor")
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

            // Input bar
            HStack(spacing: 12) {
                TextField("Type a message...", text: $messageText, axis: .vertical)
                    .lineLimit(1 ... 5)
                    .textFieldStyle(.plain)

                Button {
                    let text = messageText.trimmingCharacters(in: .whitespaces)
                    guard !text.isEmpty else { return }
                    messageText = ""
                    Task {
                        await viewModel.sendMessage(text, sessionId: sessionId)
                    }
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title2)
                }
                .disabled(messageText.trimmingCharacters(in: .whitespaces).isEmpty || viewModel.streamHandler?.isStreaming == true)
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
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

// MARK: - Display Message

struct DisplayMessage: Identifiable {
    let id: String
    let role: MessageRole
    let content: String
    var isStreaming = false
    var toolCalls: [ToolCallInfo] = []

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

                Text(markdownAttributedString(message.content))
                    .padding(12)
                    .background(message.role == .user ? Color.accentColor.opacity(0.15) : Color(.systemGray6))
                    .clipShape(RoundedRectangle(cornerRadius: 16))
            }

            if message.role == .assistant { Spacer(minLength: 60) }
        }
    }
}

private func markdownAttributedString(_ text: String) -> AttributedString {
    (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(text)
}

// MARK: - Tool Call Badge

private struct ToolCallBadge: View {
    let toolCall: ToolCallInfo
    var onTap: (() -> Void)? = nil

    private var icon: String {
        switch toolCall.status {
        case .completed: "checkmark.circle.fill"
        case .pendingConfirmation: "exclamationmark.shield.fill"
        case .failed: "xmark.circle.fill"
        case .running: "arrow.trianglehead.2.clockwise"
        }
    }

    private var iconColor: Color {
        switch toolCall.status {
        case .completed: .green
        case .pendingConfirmation: .orange
        case .failed: .red
        case .running: .blue
        }
    }

    private var statusText: String {
        switch toolCall.status {
        case .completed: "Completed"
        case .pendingConfirmation: "Needs Confirmation"
        case .failed: "Failed"
        case .running: "Running..."
        }
    }

    var body: some View {
        Button {
            onTap?()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: icon)
                    .foregroundStyle(iconColor)

                VStack(alignment: .leading) {
                    Text(toolCall.toolName)
                        .font(.caption.weight(.medium))
                    Text(statusText)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                if toolCall.status == .pendingConfirmation {
                    Image(systemName: "chevron.right")
                        .foregroundStyle(.secondary)
                }
            }
            .padding(8)
            .frame(maxWidth: .infinity)
            .background(.fill.tertiary)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .disabled(onTap == nil)
    }
}
