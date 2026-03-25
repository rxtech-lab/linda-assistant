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
    let onSend: (String) -> Void
    let onStop: () -> Void
    @ViewBuilder let header: () -> Header

    @Environment(EventManager.self) private var eventManager

    @State private var messageText = ""
    @State private var selectedToolCall: ToolCallInfo?
    @State private var selectedDocumentItem: DocumentSheetItem?
    @State private var selectedBriefingId: String?
    @State private var errorDismissTask: Task<Void, Never>?
    @State private var presentedConfirmation: ConfirmationPayload?
    @State private var presentedQuestion: QuestionPayload?
    @State private var presentedLocation: LocationRequestPayload?
    @State private var isAtBottom = true
    @State private var scrollSubject = PassthroughSubject<Void, Never>()
    private var pendingConfirmationCount: Int {
        streamHandler?.pendingConfirmations.count ?? 0
    }

    private var pendingQuestionCount: Int {
        streamHandler?.pendingQuestions.count ?? 0
    }

    private var pendingLocationCount: Int {
        streamHandler?.pendingLocations.count ?? 0
    }

    private var showPendingIndicator: Bool {
        guard let handler = streamHandler,
              handler.isStreaming,
              handler.streamingParts.isEmpty,
              handler.pendingConfirmations.isEmpty,
              handler.pendingQuestions.isEmpty,
              handler.pendingLocations.isEmpty,
              handler.error == nil
        else { return false }
        return true
    }

    /// Combine historical messages with current streaming message.
    private var allMessages: [DisplayMessage] {
        var msgs = messages
        if let handler = streamHandler, !handler.streamingParts.isEmpty,
           handler.isStreaming || !handler.pendingConfirmations.isEmpty || !handler.pendingQuestions.isEmpty || !handler
           .pendingLocations.isEmpty
        {
            // Collect all toolCallIds already in display messages to avoid duplicates
            let existingToolCallIds = Set(
                msgs.flatMap { $0.parts.compactMap { part -> String? in
                    if case let .tool(info) = part { return info.toolCallId }
                    return nil
                }}
            )

            // Filter out streaming tool calls that already exist in display messages
            let filteredParts = handler.streamingParts.filter { part in
                if case let .tool(info) = part {
                    return !existingToolCallIds.contains(info.toolCallId)
                }
                return true
            }

            if !filteredParts.isEmpty {
                msgs.append(DisplayMessage(
                    id: "streaming",
                    role: .assistant,
                    parts: filteredParts,
                    assigneeName: assigneeName
                ))
            }
        }
        return msgs
    }

    private func handleConfirmationTap() {
        logger
            .info(
                "onConfirmationTap: pendingConfirmation=\(streamHandler?.pendingConfirmation != nil ? "set" : "nil")"
            )
        if let confirmation = streamHandler?.pendingConfirmation {
            presentedConfirmation = confirmation
        }
    }

    private func handleToolCallTap(_ toolCall: ToolCallInfo) {
        // If pending question, open interactive form instead of read-only detail sheet
        if toolCall.status == .pendingQuestion {
            if let question = streamHandler?.pendingQuestions.first(where: {
                $0.toolCallId == toolCall.toolCallId
            }) {
                presentedQuestion = question
            } else if let payload = QuestionPayload.from(toolCall: toolCall) {
                // Reconstruct from tool call input when not in pending queue
                presentedQuestion = payload
            } else {
                selectedToolCall = toolCall
            }
        } else {
            selectedToolCall = toolCall
        }
    }

    private func chatListView(proxy: ScrollViewProxy) -> some View {
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
                onConfirmationTap: handleConfirmationTap,
                onToolCallTap: handleToolCallTap,
                onDocumentTap: { item in
                    selectedDocumentItem = item
                },
                onBriefingTap: { briefingId in
                    selectedBriefingId = briefingId
                }
            )
            .listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
        }
        .listStyle(.plain)
        .accessibilityIdentifier("message-list")
        .onScrollGeometryChange(for: CGPoint.self) { geometry in
            CGPoint(
                x: geometry.contentSize.height,
                y: geometry.contentSize.height - geometry.contentOffset.y - geometry.containerSize.height
            )
        } action: { old, new in
            let distanceFromBottom = new.y
            let contentGrew = new.x > old.x
            if distanceFromBottom < 50 {
                isAtBottom = true
            } else if !contentGrew {
                // Only disengage when user scrolled up, not when content growth pushed bottom away
                isAtBottom = false
            }
            logger
                .debug(
                    "scroll: isAtBottom=\(isAtBottom) distance=\(distanceFromBottom, format: .fixed(precision: 1)) contentGrew=\(contentGrew)"
                )
        }
        .scrollContentBackground(.hidden)
        .onTapGesture {
            #if canImport(UIKit)
                UIApplication.shared.sendAction(
                    #selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil
                )
            #endif
        }
        .defaultScrollAnchor(.bottom, for: .sizeChanges)
        .onAppear {
            DispatchQueue.main.async {
                proxy.scrollTo("bottom", anchor: .bottom)
            }
        }
        .onChange(of: messages.count) { oldCount, newCount in
            // Scroll to bottom when messages are first loaded (empty -> non-empty)
            if oldCount == 0, newCount > 0 {
                DispatchQueue.main.async {
                    proxy.scrollTo("bottom", anchor: .bottom)
                }
            }
        }
        .task {
            for await event in eventManager.stream {
                if case .streamContentUpdated = event {
                    guard isAtBottom else { continue }
                    DispatchQueue.main.async {
                        withAnimation {
                            proxy.scrollTo("bottom", anchor: .bottom)
                        }
                    }
                }
            }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                if isLoading {
                    MessagesLoadingView()
                        .transition(.opacity.combined(with: .scale(scale: 0.98)))
                }

                ScrollViewReader { proxy in
                    chatListView(proxy: proxy)
                }
            }
            .onChange(of: pendingConfirmationCount) {
                // Dismiss sheet if the presented confirmation was resolved (e.g. from another device)
                if let presented = presentedConfirmation,
                   !(streamHandler?.pendingConfirmations
                       .contains(where: { $0.confirmationId == presented.confirmationId }) ?? false)
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
            .overlay(alignment: .bottom) {
                if pendingQuestionCount > 0, pendingConfirmationCount == 0 {
                    PendingQuestionBanner(count: pendingQuestionCount) {
                        if let question = streamHandler?.pendingQuestion {
                            presentedQuestion = question
                        }
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(.easeInOut(duration: 0.3), value: pendingQuestionCount)
            .onChange(of: pendingQuestionCount) {
                // Dismiss sheet if the presented question was resolved
                if let presented = presentedQuestion,
                   !(streamHandler?.pendingQuestions
                       .contains(where: { $0.questionId == presented.questionId }) ?? false)
                {
                    presentedQuestion = nil
                }
                // Present next question if none is showing
                if presentedQuestion == nil,
                   let question = streamHandler?.pendingQuestion
                {
                    presentedQuestion = question
                }
            }
            .onAppear {
                if presentedQuestion == nil,
                   let question = streamHandler?.pendingQuestion
                {
                    presentedQuestion = question
                }
            }
            .overlay(alignment: .bottom) {
                if pendingLocationCount > 0, pendingConfirmationCount == 0, pendingQuestionCount == 0 {
                    PendingLocationBanner(count: pendingLocationCount) {
                        if let location = streamHandler?.pendingLocation {
                            presentedLocation = location
                        }
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(.easeInOut(duration: 0.3), value: pendingLocationCount)
            .onChange(of: pendingLocationCount) {
                // Dismiss sheet if the presented location was resolved
                if let presented = presentedLocation,
                   !(streamHandler?.pendingLocations
                       .contains(where: { $0.toolCallId == presented.toolCallId }) ?? false)
                {
                    presentedLocation = nil
                }
                // Present next location if none is showing
                if presentedLocation == nil,
                   let location = streamHandler?.pendingLocation
                {
                    presentedLocation = location
                }
            }
            .onAppear {
                if presentedLocation == nil,
                   let location = streamHandler?.pendingLocation
                {
                    presentedLocation = location
                }
            }
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
                isAtBottom = true
                onSend(text)
            } onStop: {
                onStop()
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
        .sheet(item: $presentedQuestion) { question in
            QuestionSheetView(
                question: question,
                remainingCount: max(0, (streamHandler?.pendingQuestions.count ?? 1) - 1),
                onAnswer: { answers in
                    presentedQuestion = nil
                    Task {
                        await streamHandler?.answerQuestion(
                            questionId: question.questionId,
                            action: "answer",
                            answers: answers
                        )
                        if let next = streamHandler?.pendingQuestion {
                            try? await Task.sleep(for: .milliseconds(400))
                            await MainActor.run {
                                presentedQuestion = next
                            }
                        }
                    }
                },
                onReject: {
                    presentedQuestion = nil
                    Task {
                        await streamHandler?.answerQuestion(
                            questionId: question.questionId,
                            action: "reject"
                        )
                        if let next = streamHandler?.pendingQuestion {
                            try? await Task.sleep(for: .milliseconds(400))
                            await MainActor.run {
                                presentedQuestion = next
                            }
                        }
                    }
                }
            )
        }
        .sheet(item: $presentedLocation) { location in
            LocationSheetView(
                location: location,
                onResolve: { action, latitude, longitude, accuracy, alwaysAllow in
                    presentedLocation = nil
                    Task {
                        await streamHandler?.resolveLocation(
                            toolCallId: location.toolCallId,
                            action: action,
                            latitude: latitude,
                            longitude: longitude,
                            accuracy: accuracy,
                            alwaysAllow: alwaysAllow
                        )
                        if let next = streamHandler?.pendingLocation {
                            try? await Task.sleep(for: .milliseconds(400))
                            await MainActor.run {
                                presentedLocation = next
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
        .sheet(isPresented: Binding(
            get: { selectedBriefingId != nil },
            set: { if !$0 { selectedBriefingId = nil } }
        )) {
            if let briefingId = selectedBriefingId {
                NavigationStack {
                    BriefingDetailView(briefingId: briefingId)
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button {
                                    selectedBriefingId = nil
                                } label: {
                                    Image(systemName: "xmark")
                                }
                            }
                        }
                }
            }
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

// MARK: - Pending Question Banner

private struct PendingQuestionBanner: View {
    let count: Int
    var onTap: () -> Void = {}

    var body: some View {
        Button {
            onTap()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "questionmark.circle.fill")
                    .foregroundStyle(.white)
                Text(
                    count == 1
                        ? "1 question pending"
                        : "\(count) questions pending"
                )
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.white)
                Spacer()
                Text("Answer")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.9))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(Color.purple)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .shadow(color: .purple.opacity(0.3), radius: 8, y: 4)
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
        .accessibilityIdentifier("question-banner")
    }
}

private struct PendingLocationBanner: View {
    let count: Int
    var onTap: () -> Void = {}

    var body: some View {
        Button {
            onTap()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "location.fill")
                    .foregroundStyle(.white)
                Text("Location requested")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.white)
                Spacer()
                Text("Share")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.9))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(Color.blue)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .shadow(color: .blue.opacity(0.3), radius: 8, y: 4)
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
        onSend: @escaping (String) -> Void,
        onStop: @escaping () -> Void
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
