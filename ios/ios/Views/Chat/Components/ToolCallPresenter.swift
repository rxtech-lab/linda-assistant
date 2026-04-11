import AssistantCore
import SwiftUI

/// A shared ViewModifier that attaches all tool-related sheets to any view.
///
/// Routes `ToolCallInfo` to the correct sheet:
/// - `create_document` / `update_document` → `DocumentViewerSheet`
/// - `create_briefing` → `BriefingDetailView`
/// - Everything else → `ToolCallDetailSheet`
///
/// Also manages interactive tool sheets:
/// - Confirmation → `ConfirmationSheetView`
/// - Question → `QuestionSheetView`
/// - Location → `LocationSheetView`
/// - Upload → `UploadSheetView`
struct ToolCallPresenter: ViewModifier {
    // Read-only detail sheets
    @Binding var selectedToolCall: ToolCallInfo?
    @Binding var documentItem: DocumentSheetItem?
    @Binding var briefingId: String?

    // Interactive tool sheets
    @Binding var presentedConfirmation: ConfirmationPayload?
    var pendingConfirmationCount: Int
    var onConfirmationResolve: (ConfirmationPayload, String, Bool) -> Void

    @Binding var presentedQuestion: QuestionPayload?
    var pendingQuestionCount: Int
    var onQuestionAnswer: (QuestionPayload, [[String: AnyCodable]]) -> Void
    var onQuestionReject: (QuestionPayload) -> Void

    @Binding var presentedLocation: LocationRequestPayload?
    var onLocationResolve: (LocationRequestPayload, String, Double?, Double?, Double?, Bool) -> Void

    @Binding var presentedUpload: UploadRequestPayload?
    var pendingUploadCount: Int
    var onUploadComplete: (UploadRequestPayload, [String]) -> Void
    var onUploadReject: (UploadRequestPayload) -> Void

    private static let documentToolNames: Set<String> = ["create_document", "update_document"]
    private static let briefingToolNames: Set<String> = ["create_briefing"]
    private static let slideToolNames: Set<String> = ["create_slides", "update_slides"]
    private static let dataSheetToolNames: Set<String> = ["create_data_sheet"]
    private static let uploadToolNames: Set<String> = ["request_upload"]
    private static let readUploadedFileToolNames: Set<String> = ["read_uploaded_file"]
    private static let mcpLazyToolNames: Set<String> = ["search_tools", "read_tool", "use_tool"]

    /// Binding that only fires for non-slide, non-data-sheet tool calls (presented as .sheet).
    private var nonSlideToolCall: Binding<ToolCallInfo?> {
        Binding(
            get: {
                guard let tc = selectedToolCall,
                      !Self.slideToolNames.contains(tc.toolName),
                      !Self.dataSheetToolNames.contains(tc.toolName)
                else { return nil }
                return tc
            },
            set: { selectedToolCall = $0 }
        )
    }

    /// Binding that only fires for data sheet tool calls (presented as .sheet).
    private var dataSheetId: Binding<String?> {
        Binding(
            get: {
                guard let tc = selectedToolCall,
                      Self.dataSheetToolNames.contains(tc.toolName)
                else { return nil }
                return extractDataSheetId(from: tc)
            },
            set: { if $0 == nil { selectedToolCall = nil } }
        )
    }

    private var dataSheetPresented: Binding<Bool> {
        Binding(
            get: { dataSheetId.wrappedValue != nil },
            set: { if !$0 { selectedToolCall = nil } }
        )
    }

    /// Binding that only fires for slide tool calls (presented as .fullScreenCover).
    private var slideToolDeckId: Binding<String?> {
        Binding(
            get: {
                guard let tc = selectedToolCall,
                      Self.slideToolNames.contains(tc.toolName)
                else { return nil }
                return extractSlideDeckId(from: tc)
            },
            set: { if $0 == nil { selectedToolCall = nil } }
        )
    }

    private var slideToolDeckPresented: Binding<Bool> {
        Binding(
            get: { slideToolDeckId.wrappedValue != nil },
            set: { if !$0 { selectedToolCall = nil } }
        )
    }

    func body(content: Content) -> some View {
        content
            // Read-only detail sheets (non-slide tools)
            .sheet(item: nonSlideToolCall) { toolCall in
                sheetContent(for: toolCall)
            }
        // Slide viewer as fullscreen cover
        #if os(macOS)
            .sheet(isPresented: slideToolDeckPresented) {
                if let deckId = slideToolDeckId.wrappedValue {
                    SlideViewerSheet(deckId: deckId)
                }
            }
        #else
            .fullScreenCover(isPresented: slideToolDeckPresented) {
                    if let deckId = slideToolDeckId.wrappedValue {
                        SlideViewerSheet(deckId: deckId)
                    }
                }
        #endif
                // Data sheet viewer as sheet
                .sheet(isPresented: dataSheetPresented) {
                    if let sheetId = dataSheetId.wrappedValue {
                        DataSheetViewerSheet(sheetId: sheetId)
                    }
                }
                .sheet(item: $documentItem) { item in
                    DocumentViewerSheet(documentId: item.id, initialTitle: item.title)
                }
                .sheet(isPresented: Binding(
                    get: { briefingId != nil },
                    set: { if !$0 { briefingId = nil } }
                )) {
                    if let briefingId {
                        NavigationStack {
                            BriefingDetailView(briefingId: briefingId)
                                .toolbar {
                                    ToolbarItem(placement: .cancellationAction) {
                                        Button { self.briefingId = nil } label: {
                                            Image(systemName: "xmark")
                                        }
                                    }
                                }
                        }
                    }
                }
                // Interactive tool sheets
                .sheet(item: $presentedConfirmation) { confirmation in
                    ConfirmationSheetView(
                        confirmation: confirmation,
                        remainingCount: max(0, pendingConfirmationCount - 1),
                        onResolve: { action, alwaysAllow in
                            onConfirmationResolve(confirmation, action, alwaysAllow)
                        }
                    )
                }
                .sheet(item: $presentedQuestion) { question in
                    QuestionSheetView(
                        question: question,
                        remainingCount: max(0, pendingQuestionCount - 1),
                        onAnswer: { answers in
                            onQuestionAnswer(question, answers)
                        },
                        onReject: {
                            onQuestionReject(question)
                        }
                    )
                }
                .sheet(item: $presentedLocation) { location in
                    LocationSheetView(
                        location: location,
                        onResolve: { action, latitude, longitude, accuracy, alwaysAllow in
                            onLocationResolve(location, action, latitude, longitude, accuracy, alwaysAllow)
                        }
                    )
                }
                .sheet(item: $presentedUpload) { upload in
                    UploadSheetView(
                        upload: upload,
                        remainingCount: max(0, pendingUploadCount - 1),
                        onComplete: { uploadedKeys in
                            onUploadComplete(upload, uploadedKeys)
                        },
                        onReject: {
                            onUploadReject(upload)
                        }
                    )
                }
    }

    @ViewBuilder
    private func sheetContent(for toolCall: ToolCallInfo) -> some View {
        if Self.documentToolNames.contains(toolCall.toolName),
           let docId = extractDocumentId(from: toolCall)
        {
            let title = toolCall.input?["title"]?.stringValue
            DocumentViewerSheet(documentId: docId, initialTitle: title)
        } else if Self.briefingToolNames.contains(toolCall.toolName),
                  let briefId = extractBriefingId(from: toolCall)
        {
            NavigationStack {
                BriefingDetailView(briefingId: briefId)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button { selectedToolCall = nil } label: {
                                Image(systemName: "xmark")
                            }
                        }
                    }
            }
        } else if Self.slideToolNames.contains(toolCall.toolName),
                  let deckId = extractSlideDeckId(from: toolCall)
        {
            SlideViewerSheet(deckId: deckId)
        } else if Self.dataSheetToolNames.contains(toolCall.toolName),
                  let sheetId = extractDataSheetId(from: toolCall)
        {
            DataSheetViewerSheet(sheetId: sheetId)
        } else if Self.uploadToolNames.contains(toolCall.toolName),
                  toolCall.status == .completed,
                  let uploadId = extractUploadId(from: toolCall)
        {
            let keys = extractUploadedKeys(from: toolCall)
            NavigationStack {
                UploadCompletionView(uploadId: uploadId, uploadedKeys: keys)
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        } else if Self.readUploadedFileToolNames.contains(toolCall.toolName),
                  let uploadId = extractReadUploadId(from: toolCall)
        {
            NavigationStack {
                ReadUploadedFileView(
                    uploadId: uploadId,
                    errorMessage: extractToolError(from: toolCall)
                )
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        } else if Self.mcpLazyToolNames.contains(toolCall.toolName) {
            McpToolDetailSheet(toolCall: toolCall)
        } else {
            ToolCallDetailSheet(toolCall: toolCall)
        }
    }

    private func extractDocumentId(from toolCall: ToolCallInfo) -> String? {
        if case let .object(obj) = toolCall.result {
            if let id = obj["documentId"]?.stringValue { return id }
            if case let .object(inner) = obj["value"],
               let id = inner["documentId"]?.stringValue
            { return id }
        }
        if toolCall.toolName == "update_document",
           let id = toolCall.input?["id"]?.stringValue
        { return id }
        return nil
    }

    private func extractUploadId(from toolCall: ToolCallInfo) -> String? {
        // Check the direct uploadId property first (set during streaming)
        if let id = toolCall.uploadId { return id }
        // Fall back to extracting from tool result (history)
        if case let .object(obj) = toolCall.result {
            if let id = obj["uploadId"]?.stringValue { return id }
            if case let .object(inner) = obj["value"],
               let id = inner["uploadId"]?.stringValue
            { return id }
        }
        return nil
    }

    private func extractUploadedKeys(from toolCall: ToolCallInfo) -> [String] {
        if case let .object(obj) = toolCall.result,
           case let .array(keys) = obj["uploadedKeys"]
        {
            return keys.compactMap(\.stringValue)
        }
        if case let .object(obj) = toolCall.result,
           case let .object(inner) = obj["value"],
           case let .array(keys) = inner["uploadedKeys"]
        {
            return keys.compactMap(\.stringValue)
        }
        return []
    }

    private func extractReadUploadId(from toolCall: ToolCallInfo) -> String? {
        toolCall.input?["uploadId"]?.stringValue
    }

    private func extractToolError(from toolCall: ToolCallInfo) -> String? {
        if let msg = toolCall.errorMessage { return msg }
        if case let .object(obj) = toolCall.result {
            if let err = obj["error"]?.stringValue { return err }
            if case let .object(inner) = obj["value"],
               let err = inner["error"]?.stringValue
            { return err }
        }
        return nil
    }

    private func extractSlideDeckId(from toolCall: ToolCallInfo) -> String? {
        if case let .object(obj) = toolCall.result {
            if let id = obj["deckId"]?.stringValue { return id }
            if case let .object(inner) = obj["value"],
               let id = inner["deckId"]?.stringValue
            { return id }
        }
        // For update_slides, deckId is in the input
        if let id = toolCall.input?["deckId"]?.stringValue { return id }
        return nil
    }

    private func extractBriefingId(from toolCall: ToolCallInfo) -> String? {
        if case let .object(obj) = toolCall.result {
            if let id = obj["briefingId"]?.stringValue { return id }
            if case let .object(inner) = obj["value"],
               let id = inner["briefingId"]?.stringValue
            { return id }
        }
        return nil
    }

    private func extractDataSheetId(from toolCall: ToolCallInfo) -> String? {
        if case let .object(obj) = toolCall.result {
            if let id = obj["sheetId"]?.stringValue { return id }
            if case let .object(inner) = obj["value"],
               let id = inner["sheetId"]?.stringValue
            { return id }
        }
        return nil
    }
}

extension View {
    /// Attach all tool-related sheet routing.
    ///
    /// Read-only: `selectedToolCall`, `documentItem`, `briefingId`
    /// Interactive: `presentedConfirmation`, `presentedQuestion`, `presentedLocation`, `presentedUpload`
    func toolCallPresenter(
        selectedToolCall: Binding<ToolCallInfo?>,
        documentItem: Binding<DocumentSheetItem?> = .constant(nil),
        briefingId: Binding<String?> = .constant(nil),
        presentedConfirmation: Binding<ConfirmationPayload?> = .constant(nil),
        pendingConfirmationCount: Int = 0,
        onConfirmationResolve: @escaping (ConfirmationPayload, String, Bool) -> Void = { _, _, _ in },
        presentedQuestion: Binding<QuestionPayload?> = .constant(nil),
        pendingQuestionCount: Int = 0,
        onQuestionAnswer: @escaping (QuestionPayload, [[String: AnyCodable]]) -> Void = { _, _ in },
        onQuestionReject: @escaping (QuestionPayload) -> Void = { _ in },
        presentedLocation: Binding<LocationRequestPayload?> = .constant(nil),
        onLocationResolve: @escaping (LocationRequestPayload, String, Double?, Double?, Double?, Bool)
            -> Void = { _, _, _, _, _, _ in },
        presentedUpload: Binding<UploadRequestPayload?> = .constant(nil),
        pendingUploadCount: Int = 0,
        onUploadComplete: @escaping (UploadRequestPayload, [String]) -> Void = { _, _ in },
        onUploadReject: @escaping (UploadRequestPayload) -> Void = { _ in }
    ) -> some View {
        modifier(ToolCallPresenter(
            selectedToolCall: selectedToolCall,
            documentItem: documentItem,
            briefingId: briefingId,
            presentedConfirmation: presentedConfirmation,
            pendingConfirmationCount: pendingConfirmationCount,
            onConfirmationResolve: onConfirmationResolve,
            presentedQuestion: presentedQuestion,
            pendingQuestionCount: pendingQuestionCount,
            onQuestionAnswer: onQuestionAnswer,
            onQuestionReject: onQuestionReject,
            presentedLocation: presentedLocation,
            onLocationResolve: onLocationResolve,
            presentedUpload: presentedUpload,
            pendingUploadCount: pendingUploadCount,
            onUploadComplete: onUploadComplete,
            onUploadReject: onUploadReject
        ))
    }
}
