import AssistantCore
import SwiftUI

/// A shared ViewModifier that attaches tool-call sheets to any view.
///
/// Routes `ToolCallInfo` to the correct sheet:
/// - `create_document` / `update_document` → `DocumentViewerSheet`
/// - `create_briefing` → `BriefingDetailView`
/// - Everything else → `ToolCallDetailSheet`
///
/// Also accepts direct `documentItem` and `briefingId` bindings for cases
/// where the caller already extracted the ID (e.g. `DocumentToolCard` / `BriefingToolCard`).
struct ToolCallPresenter: ViewModifier {
    @Binding var selectedToolCall: ToolCallInfo?
    @Binding var documentItem: DocumentSheetItem?
    @Binding var briefingId: String?

    private static let documentToolNames: Set<String> = ["create_document", "update_document"]
    private static let briefingToolNames: Set<String> = ["create_briefing"]

    func body(content: Content) -> some View {
        content
            .sheet(item: $selectedToolCall) { toolCall in
                sheetContent(for: toolCall)
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

    private func extractBriefingId(from toolCall: ToolCallInfo) -> String? {
        if case let .object(obj) = toolCall.result {
            if let id = obj["briefingId"]?.stringValue { return id }
            if case let .object(inner) = obj["value"],
               let id = inner["briefingId"]?.stringValue
            { return id }
        }
        return nil
    }
}

extension View {
    /// Attach tool-call sheet routing. Set `selectedToolCall` to present.
    /// Optionally pass `documentItem` / `briefingId` for direct presentation
    /// from inline cards that already extracted the ID.
    func toolCallPresenter(
        selectedToolCall: Binding<ToolCallInfo?>,
        documentItem: Binding<DocumentSheetItem?> = .constant(nil),
        briefingId: Binding<String?> = .constant(nil)
    ) -> some View {
        modifier(ToolCallPresenter(
            selectedToolCall: selectedToolCall,
            documentItem: documentItem,
            briefingId: briefingId
        ))
    }
}
