import AssistantCore
import SwiftUI

struct ChatOptionsSheet: View {
    @Environment(\.dismiss) private var dismiss
    let assignees: [Assignee]
    let selectedAssigneeId: String?
    let documents: [Document]
    let slideDecks: [SlideDeckListItem]
    let audios: [Audio]
    var onSelectAssignee: (Assignee) -> Void
    var onDeleteDocument: (Document) -> Void
    var onDeleteAudio: (Audio) -> Void
    var onClearMessages: () -> Void

    private let maxPreviewCount = 5
    private let maxSlidePreviewCount = 5
    private let maxAudioPreviewCount = 5

    @State private var showingAllAssignees = false
    @State private var showingAllDocuments = false
    @State private var showingAllSlides = false
    @State private var showingAllAudios = false
    @State private var documentToDelete: Document?
    @State private var audioToDelete: Audio?
    @State private var selectedDocumentItem: DocumentSheetItem?
    @State private var selectedSlideDeckId: String?
    @State private var selectedAudioItem: AudioSheetItem?

    private var previewAssignees: [Assignee] {
        Array(assignees.prefix(maxPreviewCount))
    }

    private var previewDocuments: [Document] {
        Array(documents.prefix(maxPreviewCount))
    }

    private var previewSlideDecks: [SlideDeckListItem] {
        Array(slideDecks.prefix(maxSlidePreviewCount))
    }

    private var previewAudios: [Audio] {
        Array(audios.prefix(maxAudioPreviewCount))
    }

    var body: some View {
        #if os(macOS)
            macOSContent
        #else
            iOSContent
        #endif
    }

    // MARK: - Shared Components

    private func assigneeRow(_ assignee: Assignee) -> some View {
        Button {
            onSelectAssignee(assignee)
        } label: {
            HStack {
                Text(assignee.name)
                    .foregroundStyle(.primary)
                Spacer()
                if assignee.id == selectedAssigneeId {
                    Image(systemName: "checkmark")
                        .foregroundStyle(.tint)
                }
            }
        }
    }

    private func documentRow(_ doc: Document) -> some View {
        Button {
            selectedDocumentItem = DocumentSheetItem(id: doc.id, title: doc.title)
        } label: {
            HStack {
                Image(systemName: "doc.text")
                    .foregroundStyle(.secondary)
                Text(doc.title)
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                Spacer()
                Text(doc.format)
                    .font(.caption2)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(.quaternary)
                    .clipShape(Capsule())
            }
        }
    }

    private func slideDeckRow(_ deck: SlideDeckListItem) -> some View {
        Button {
            selectedSlideDeckId = deck.id
        } label: {
            HStack {
                Image(systemName: "rectangle.on.rectangle")
                    .foregroundStyle(.secondary)
                Text(deck.title)
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                Spacer()
                Text("\(deck.pageCount) \(deck.pageCount == 1 ? "slide" : "slides")")
                    .font(.caption2)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(.quaternary)
                    .clipShape(Capsule())
            }
        }
    }

    private func audioRow(_ audio: Audio) -> some View {
        Button {
            selectedAudioItem = AudioSheetItem(id: audio.id, title: audio.title)
        } label: {
            HStack {
                Image(systemName: "waveform")
                    .foregroundStyle(.secondary)
                Text(audio.title)
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                Spacer()
                if audio.status == "generating" {
                    HStack(spacing: 4) {
                        ProgressView().controlSize(.mini)
                        Text("Generating")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                } else if audio.status == "failed" {
                    Text("FAILED")
                        .font(.caption2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.red.opacity(0.2))
                        .clipShape(Capsule())
                } else {
                    Text(audio.type)
                        .font(.caption2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(.quaternary)
                        .clipShape(Capsule())
                }
            }
        }
    }

    private func sectionHeader(title: String, icon: String, count: Int, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Label(title, systemImage: icon)
                if count > 0 {
                    Text("\(count)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
        .foregroundStyle(.primary)
    }

    // MARK: - macOS

    #if os(macOS)
        private var macOSContent: some View {
            VStack(spacing: 0) {
                HStack {
                    Text("Options")
                        .font(.headline)
                    Spacer()
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                            .font(.title2)
                    }
                    .buttonStyle(.plain)
                }
                .padding()

                Divider()

                Form {
                    Section {
                        ForEach(previewAssignees, id: \.id) { assignee in
                            assigneeRow(assignee)
                                .buttonStyle(.plain)
                        }
                    } header: {
                        sectionHeader(title: "Assistants", icon: "person.2", count: assignees.count) {
                            showingAllAssignees = true
                        }
                    }

                    if !documents.isEmpty {
                        Section {
                            ForEach(previewDocuments) { doc in
                                documentRow(doc)
                                    .buttonStyle(.plain)
                            }
                        } header: {
                            sectionHeader(title: "Documents", icon: "doc.text", count: documents.count) {
                                showingAllDocuments = true
                            }
                        }
                    }

                    if !audios.isEmpty {
                        Section {
                            ForEach(previewAudios) { audio in
                                audioRow(audio)
                                    .buttonStyle(.plain)
                            }
                        } header: {
                            sectionHeader(title: "Audio", icon: "waveform", count: audios.count) {
                                showingAllAudios = true
                            }
                        }
                    }

                    if !slideDecks.isEmpty {
                        Section {
                            ForEach(previewSlideDecks) { deck in
                                slideDeckRow(deck)
                                    .buttonStyle(.plain)
                            }
                        } header: {
                            sectionHeader(
                                title: "Slides", icon: "rectangle.on.rectangle",
                                count: slideDecks.count
                            ) {
                                showingAllSlides = true
                            }
                        }
                    }

                    Section {
                        Button {
                            onClearMessages()
                        } label: {
                            Label("Clear Messages", systemImage: "trash")
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(.red)
                        .accessibilityIdentifier("clear-messages-button")
                    }
                }
                .formStyle(.grouped)
            }
            .frame(width: 400, height: 400)
            .sheet(isPresented: $showingAllAssignees) {
                AllAssigneesSheet(
                    selectedAssigneeId: selectedAssigneeId,
                    onSelectAssignee: { assignee in
                        onSelectAssignee(assignee)
                    }
                )
            }
            .sheet(isPresented: $showingAllDocuments) {
                if let assigneeId = selectedAssigneeId {
                    AllDocumentsSheet(
                        assigneeId: assigneeId,
                        onSelectDocument: { doc in
                            showingAllDocuments = false
                            selectedDocumentItem = DocumentSheetItem(id: doc.id, title: doc.title)
                        },
                        onDeleteDocument: { doc in
                            documentToDelete = doc
                        }
                    )
                }
            }
            .sheet(item: $selectedDocumentItem) { item in
                DocumentViewerSheet(documentId: item.id, initialTitle: item.title)
            }
            .sheet(item: $selectedAudioItem) { item in
                AudioViewerSheet(audioId: item.id, initialTitle: item.title)
            }
            .slideViewerPresenter(deckId: $selectedSlideDeckId)
            .sheet(isPresented: $showingAllSlides) {
                if let assigneeId = selectedAssigneeId {
                    AllSlideDecksSheet(assigneeId: assigneeId)
                }
            }
            .sheet(isPresented: $showingAllAudios) {
                if let assigneeId = selectedAssigneeId {
                    AllAudiosSheet(
                        assigneeId: assigneeId,
                        onSelectAudio: { audio in
                            showingAllAudios = false
                            selectedAudioItem = AudioSheetItem(id: audio.id, title: audio.title)
                        },
                        onDeleteAudio: { audio in
                            audioToDelete = audio
                        }
                    )
                }
            }
            .confirmationDialog(
                "Delete Document",
                isPresented: Binding(
                    get: { documentToDelete != nil },
                    set: { if !$0 { documentToDelete = nil } }
                ),
                presenting: documentToDelete
            ) { doc in
                Button("Delete", role: .destructive) {
                    onDeleteDocument(doc)
                    documentToDelete = nil
                }
            } message: { doc in
                Text("Are you sure you want to delete \"\(doc.title)\"?")
            }
            .confirmationDialog(
                "Delete Audio",
                isPresented: Binding(
                    get: { audioToDelete != nil },
                    set: { if !$0 { audioToDelete = nil } }
                ),
                presenting: audioToDelete
            ) { audio in
                Button("Delete", role: .destructive) {
                    onDeleteAudio(audio)
                    audioToDelete = nil
                }
            } message: { audio in
                Text("Are you sure you want to delete \"\(audio.title)\"?")
            }
        }
    #endif

    // MARK: - iOS

    #if os(iOS)
        private var iOSContent: some View {
            NavigationStack {
                List {
                    Section {
                        ForEach(previewAssignees, id: \.id) { assignee in
                            assigneeRow(assignee)
                        }
                    } header: {
                        sectionHeader(title: "Assistants", icon: "person.2", count: assignees.count) {
                            showingAllAssignees = true
                        }
                    }

                    if !documents.isEmpty {
                        Section {
                            ForEach(previewDocuments) { doc in
                                documentRow(doc)
                                    .swipeActions(edge: .trailing) {
                                        Button(role: .destructive) {
                                            documentToDelete = doc
                                        } label: {
                                            Label("Delete", systemImage: "trash")
                                        }
                                    }
                            }
                        } header: {
                            sectionHeader(title: "Documents", icon: "doc.text", count: documents.count) {
                                showingAllDocuments = true
                            }
                        }
                    }

                    if !audios.isEmpty {
                        Section {
                            ForEach(previewAudios) { audio in
                                audioRow(audio)
                                    .swipeActions(edge: .trailing) {
                                        Button(role: .destructive) {
                                            audioToDelete = audio
                                        } label: {
                                            Label("Delete", systemImage: "trash")
                                        }
                                    }
                            }
                        } header: {
                            sectionHeader(title: "Audio", icon: "waveform", count: audios.count) {
                                showingAllAudios = true
                            }
                        }
                    }

                    if !slideDecks.isEmpty {
                        Section {
                            ForEach(previewSlideDecks) { deck in
                                slideDeckRow(deck)
                            }
                        } header: {
                            sectionHeader(
                                title: "Slides", icon: "rectangle.on.rectangle",
                                count: slideDecks.count
                            ) {
                                showingAllSlides = true
                            }
                        }
                    }

                    Section {
                        Button {
                            onClearMessages()
                        } label: {
                            Label("Clear Messages", systemImage: "trash")
                        }
                        .foregroundStyle(.red)
                        .accessibilityIdentifier("clear-messages-button")
                    }
                }
                .navigationTitle("Options")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") { dismiss() }
                    }
                }
            }
            .frame(minHeight: 200)
            .presentationDetents([.medium, .large])
            .sheet(isPresented: $showingAllAssignees) {
                AllAssigneesSheet(
                    selectedAssigneeId: selectedAssigneeId,
                    onSelectAssignee: { assignee in
                        dismiss()
                        onSelectAssignee(assignee)
                    }
                )
            }
            .sheet(isPresented: $showingAllDocuments) {
                if let assigneeId = selectedAssigneeId {
                    AllDocumentsSheet(
                        assigneeId: assigneeId,
                        onSelectDocument: { doc in
                            showingAllDocuments = false
                            selectedDocumentItem = DocumentSheetItem(id: doc.id, title: doc.title)
                        },
                        onDeleteDocument: { doc in
                            documentToDelete = doc
                        }
                    )
                }
            }
            .sheet(item: $selectedDocumentItem) { item in
                DocumentViewerSheet(documentId: item.id, initialTitle: item.title)
            }
            .sheet(item: $selectedAudioItem) { item in
                AudioViewerSheet(audioId: item.id, initialTitle: item.title)
            }
            .slideViewerPresenter(deckId: $selectedSlideDeckId)
            .sheet(isPresented: $showingAllSlides) {
                if let assigneeId = selectedAssigneeId {
                    AllSlideDecksSheet(assigneeId: assigneeId)
                }
            }
            .sheet(isPresented: $showingAllAudios) {
                if let assigneeId = selectedAssigneeId {
                    AllAudiosSheet(
                        assigneeId: assigneeId,
                        onSelectAudio: { audio in
                            showingAllAudios = false
                            selectedAudioItem = AudioSheetItem(id: audio.id, title: audio.title)
                        },
                        onDeleteAudio: { audio in
                            audioToDelete = audio
                        }
                    )
                }
            }
            .confirmationDialog(
                "Delete Document",
                isPresented: Binding(
                    get: { documentToDelete != nil },
                    set: { if !$0 { documentToDelete = nil } }
                ),
                presenting: documentToDelete
            ) { doc in
                Button("Delete", role: .destructive) {
                    onDeleteDocument(doc)
                    documentToDelete = nil
                }
            } message: { doc in
                Text("Are you sure you want to delete \"\(doc.title)\"?")
            }
            .confirmationDialog(
                "Delete Audio",
                isPresented: Binding(
                    get: { audioToDelete != nil },
                    set: { if !$0 { audioToDelete = nil } }
                ),
                presenting: audioToDelete
            ) { audio in
                Button("Delete", role: .destructive) {
                    onDeleteAudio(audio)
                    audioToDelete = nil
                }
            } message: { audio in
                Text("Are you sure you want to delete \"\(audio.title)\"?")
            }
        }
    #endif
}

// MARK: - Preview Helpers

private func previewAssignee(id: String, name: String, email: String) -> Assignee {
    let json = """
    {"id":"\(id)","userId":"u1","name":"\(name)","email":"\(email)"}
    """
    return try! JSONDecoder().decode(Assignee.self, from: Data(json.utf8))
}

#Preview("With selected") {
    ChatOptionsSheet(
        assignees: [
            previewAssignee(id: "1", name: "Linda", email: "linda@example.com"),
            previewAssignee(id: "2", name: "Bob", email: "bob@example.com"),
        ],
        selectedAssigneeId: "1",
        documents: [],
        slideDecks: [],
        audios: [],
        onSelectAssignee: { _ in },
        onDeleteDocument: { _ in },
        onDeleteAudio: { _ in },
        onClearMessages: {}
    )
}

#Preview("No selection") {
    ChatOptionsSheet(
        assignees: [
            previewAssignee(id: "1", name: "Linda", email: "linda@example.com"),
        ],
        selectedAssigneeId: nil,
        documents: [],
        slideDecks: [],
        audios: [],
        onSelectAssignee: { _ in },
        onDeleteDocument: { _ in },
        onDeleteAudio: { _ in },
        onClearMessages: {}
    )
}
