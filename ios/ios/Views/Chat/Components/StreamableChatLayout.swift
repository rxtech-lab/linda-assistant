import AssistantCore
import os
import SwiftUI

private let logger = Logger(subsystem: "lindaAssistant", category: "StreamableChatLayout")

struct StreamableChatLayout<Header: View>: View {
    let messages: [DisplayMessage]
    let assigneeName: String?
    let isLoading: Bool
    let streamHandler: ChatStreamHandler?
    @Binding var showingConfirmation: Bool
    let displayError: String?
    let onClearError: () -> Void
    let onSend: (String) async -> Void
    @ViewBuilder let header: () -> Header

    @State private var messageText = ""
    @State private var selectedToolCall: ToolCallInfo?
    @State private var errorDismissTask: Task<Void, Never>?

    private var showPendingIndicator: Bool {
        guard let handler = streamHandler,
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
                if isLoading {
                    MessagesLoadingView()
                        .transition(.opacity.combined(with: .scale(scale: 0.98)))
                }

                if !isLoading {
                    ScrollViewReader { proxy in
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: 12) {
                                header()

                                MessageList(
                                    messages: messages,
                                    assigneeName: assigneeName,
                                    streamingText: streamHandler?.isStreaming == true
                                        ? streamHandler?.streamedText : nil,
                                    streamingToolCalls: streamHandler?.toolCalls ?? [],
                                    showPendingIndicator: showPendingIndicator,
                                    showStreamComplete: streamHandler?.isStreaming == false
                                        && !messages.isEmpty
                                        && messages.last?.role == .assistant,
                                    onConfirmationTap: {
                                        logger
                                            .info(
                                                "onConfirmationTap: pendingConfirmation=\(streamHandler?.pendingConfirmation != nil ? "set" : "nil")"
                                            )
                                        showingConfirmation = true
                                    },
                                    onToolCallTap: { toolCall in
                                        selectedToolCall = toolCall
                                    }
                                )
                            }
                            .padding()
                        }
                        .onChange(of: messages.count) {
                            proxy.scrollTo("bottomAnchor", anchor: .bottom)
                        }
                        .onChange(of: streamHandler?.streamedText) {
                            proxy.scrollTo("bottomAnchor", anchor: .bottom)
                        }
                        .onChange(of: streamHandler?.toolCalls.count) {
                            proxy.scrollTo("bottomAnchor", anchor: .bottom)
                        }
                        .onChange(of: streamHandler?.isStreaming) {
                            proxy.scrollTo("bottomAnchor", anchor: .bottom)
                        }
                        .onChange(of: streamHandler?.pendingConfirmation?.toolCallId) {
                            if streamHandler?.pendingConfirmation != nil {
                                showingConfirmation = true
                            }
                        }
                        .onAppear {
                            if !messages.isEmpty {
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
            .animation(.easeInOut(duration: 0.5), value: isLoading)
            .overlay(alignment: .top) {
                if let errorMessage = displayError {
                    ErrorBannerView(message: errorMessage) {
                        withAnimation(.easeInOut(duration: 0.3)) {
                            onClearError()
                        }
                    }
                }
            }
            .animation(.easeInOut(duration: 0.3), value: displayError != nil)
            .onChange(of: displayError) {
                errorDismissTask?.cancel()
                if displayError != nil {
                    errorDismissTask = Task {
                        try? await Task.sleep(for: .seconds(6))
                        guard !Task.isCancelled else { return }
                        withAnimation(.easeInOut(duration: 0.3)) {
                            onClearError()
                        }
                    }
                }
            }

            #if canImport(UIKit)
                Divider()
            #endif

            MessageInput(
                text: $messageText,
                isStreaming: streamHandler?.isStreaming == true
            ) { text in
                Task {
                    await onSend(text)
                }
            } onStop: {
                // Intentionally disabled for now.
            }
        }
        .sheet(isPresented: $showingConfirmation) {
            if let confirmation = streamHandler?.pendingConfirmation {
                let _ = logger.info("sheet: rendering ConfirmationSheetView for toolName=\(confirmation.toolName)")
                ConfirmationSheetView(
                    confirmation: confirmation,
                    onResolve: { action, alwaysAllow in
                        Task {
                            await streamHandler?.resolveConfirmation(
                                confirmationId: confirmation.confirmationId,
                                action: action,
                                alwaysAllow: alwaysAllow
                            )
                        }
                        showingConfirmation = false
                    }
                )
            } else {
                let _ = logger.warning("sheet: pendingConfirmation is nil, dismissing")
                Color.clear.onAppear { showingConfirmation = false }
            }
        }
        .sheet(item: $selectedToolCall) { toolCall in
            ToolCallDetailSheet(toolCall: toolCall)
        }
    }
}

extension StreamableChatLayout where Header == EmptyView {
    init(
        messages: [DisplayMessage],
        assigneeName: String?,
        isLoading: Bool,
        streamHandler: ChatStreamHandler?,
        showingConfirmation: Binding<Bool>,
        displayError: String?,
        onClearError: @escaping () -> Void,
        onSend: @escaping (String) async -> Void
    ) {
        self.messages = messages
        self.assigneeName = assigneeName
        self.isLoading = isLoading
        self.streamHandler = streamHandler
        _showingConfirmation = showingConfirmation
        self.displayError = displayError
        self.onClearError = onClearError
        self.onSend = onSend
        header = { EmptyView() }
    }
}
