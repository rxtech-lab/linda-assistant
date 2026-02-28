import AssistantCore
import Combine
import os
import SwiftUI

private let logger = Logger(subsystem: "lindaAssistant", category: "StreamableChatLayout")

struct StreamableChatLayout<Header: View>: View {
    let messages: [DisplayMessage]
    let assigneeName: String?
    let isLoading: Bool
    let streamHandler: ChatStreamHandler?
    let displayError: String?
    let onClearError: () -> Void
    let onSend: (String) async -> Void
    let onStop: () async -> Void
    @ViewBuilder let header: () -> Header

    @Environment(EventManager.self) private var eventManager

    @State private var messageText = ""
    @State private var selectedToolCall: ToolCallInfo?
    @State private var selectedDocumentItem: DocumentSheetItem?
    @State private var errorDismissTask: Task<Void, Never>?
    @State private var presentedConfirmation: ConfirmationPayload?
    @State private var scrollSubject = PassthroughSubject<Void, Never>()
    private var pendingConfirmationCount: Int {
        streamHandler?.pendingConfirmations.count ?? 0
    }

    private var showPendingIndicator: Bool {
        guard let handler = streamHandler,
              handler.isStreaming,
              handler.streamingParts.isEmpty,
              handler.pendingConfirmations.isEmpty,
              handler.error == nil
        else { return false }
        return true
    }

    /// Combine historical messages with current streaming message.
    private var allMessages: [DisplayMessage] {
        var msgs = messages
        if let handler = streamHandler, handler.isStreaming, !handler.streamingParts.isEmpty {
            msgs.append(DisplayMessage(
                id: "streaming",
                role: .assistant,
                parts: handler.streamingParts,
                assigneeName: assigneeName
            ))
        }
        return msgs
    }

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                if isLoading {
                    MessagesLoadingView()
                        .transition(.opacity.combined(with: .scale(scale: 0.98)))
                }

                ScrollViewReader { proxy in
                    List {
                        Section {
                            header()
                        }
                        .id("header")
                        .listRowSeparator(.hidden)
                        .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))

                        MessageList(
                            messages: allMessages,
                            assigneeName: assigneeName,
                            showPendingIndicator: showPendingIndicator,
                            showStreamComplete: streamHandler?.isStreaming == false
                                && !messages.isEmpty
                                && messages.last?.role == .assistant,
                            onConfirmationTap: {
                                logger
                                    .info(
                                        "onConfirmationTap: pendingConfirmation=\(streamHandler?.pendingConfirmation != nil ? "set" : "nil")"
                                    )
                                if let confirmation = streamHandler?.pendingConfirmation {
                                    presentedConfirmation = confirmation
                                }
                            },
                            onToolCallTap: { toolCall in
                                selectedToolCall = toolCall
                            },
                            onDocumentTap: { item in
                                selectedDocumentItem = item
                            }
                        )
                        .listRowSeparator(.hidden)
                        .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                    .defaultScrollAnchor(.bottom, for: .sizeChanges)
                    .onAppear {
                        proxy.scrollTo("bottom", anchor: .bottom)
                    }
                    .task {
                        for await event in eventManager.stream {
                            if case .streamContentUpdated = event {
                                withAnimation {
                                    proxy.scrollTo("bottom", anchor: .bottom)
                                }
                            }
                        }
                    }
                }
            }
            .onChange(of: pendingConfirmationCount) {
                // Dismiss sheet if the presented confirmation was resolved (e.g. from another device)
                if let presented = presentedConfirmation,
                   !(streamHandler?.pendingConfirmations.contains(where: { $0.confirmationId == presented.confirmationId }) ?? false)
                {
                    presentedConfirmation = nil
                }
                // Present next confirmation if none is showing
                if presentedConfirmation == nil,
                   let confirmation = streamHandler?.pendingConfirmation
                {
                    presentedConfirmation = confirmation
                }
            }
            .onAppear {
                // Present confirmation sheet if already loaded (e.g. app reopen)
                if presentedConfirmation == nil,
                   let confirmation = streamHandler?.pendingConfirmation
                {
                    presentedConfirmation = confirmation
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
            .overlay(alignment: .bottom) {
                if pendingConfirmationCount > 0 {
                    PendingConfirmationBanner(count: pendingConfirmationCount) {
                        if let confirmation = streamHandler?.pendingConfirmation {
                            presentedConfirmation = confirmation
                        }
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(.easeInOut(duration: 0.3), value: pendingConfirmationCount)
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
                Task { await onStop() }
            }
        }
        .sheet(item: $presentedConfirmation) { confirmation in
            let _ = logger.info("sheet: rendering ConfirmationSheetView for toolName=\(confirmation.toolName)")
            ConfirmationSheetView(
                confirmation: confirmation,
                remainingCount: max(0, (streamHandler?.pendingConfirmations.count ?? 1) - 1),
                onResolve: { action, alwaysAllow in
                    // Dismiss current sheet immediately
                    presentedConfirmation = nil
                    Task {
                        await streamHandler?.resolveConfirmation(
                            confirmationId: confirmation.confirmationId,
                            action: action,
                            alwaysAllow: alwaysAllow
                        )
                        // After resolving, check if there's another confirmation in the queue
                        if let next = streamHandler?.pendingConfirmation {
                            // Brief delay to let sheet dismiss animation complete
                            try? await Task.sleep(for: .milliseconds(400))
                            await MainActor.run {
                                presentedConfirmation = next
                            }
                        }
                    }
                }
            )
        }
        .sheet(item: $selectedToolCall) { toolCall in
            ToolCallDetailSheet(toolCall: toolCall)
        }
        .sheet(item: $selectedDocumentItem) { item in
            DocumentViewerSheet(documentId: item.id, initialTitle: item.title)
        }
    }
}

// MARK: - Pending Confirmation Banner

private struct PendingConfirmationBanner: View {
    let count: Int
    var onTap: () -> Void = {}

    var body: some View {
        Button {
            onTap()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.shield.fill")
                    .foregroundStyle(.white)
                Text(
                    count == 1
                        ? "1 confirmation pending"
                        : "\(count) confirmations pending"
                )
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.white)
                Spacer()
                Text("Review")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.9))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(Color.orange)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .shadow(color: .orange.opacity(0.3), radius: 8, y: 4)
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }
}

#Preview("Pending Banner - 1") {
    ZStack(alignment: .bottom) {
        Color.gray.opacity(0.15).ignoresSafeArea()
        PendingConfirmationBanner(count: 1)
    }
}

#Preview("Pending Banner - 3") {
    ZStack(alignment: .bottom) {
        Color.gray.opacity(0.15).ignoresSafeArea()
        PendingConfirmationBanner(count: 3)
    }
}

extension StreamableChatLayout where Header == EmptyView {
    init(
        messages: [DisplayMessage],
        assigneeName: String?,
        isLoading: Bool,
        streamHandler: ChatStreamHandler?,
        displayError: String?,
        onClearError: @escaping () -> Void,
        onSend: @escaping (String) async -> Void,
        onStop: @escaping () async -> Void
    ) {
        self.messages = messages
        self.assigneeName = assigneeName
        self.isLoading = isLoading
        self.streamHandler = streamHandler
        self.displayError = displayError
        self.onClearError = onClearError
        self.onSend = onSend
        self.onStop = onStop
        header = { EmptyView() }
    }
}
