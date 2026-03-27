import AssistantCore
import SwiftUI

struct ExtensionListView: View {
    @Environment(AuthManager.self) private var authManager
    @Environment(EventManager.self) private var eventManager
    @State private var extensions: [ExtensionWithStatus] = []
    @State private var isLoading = true
    @State private var error: String?
    @State private var showingAddSheet = false

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    private var systemExtensions: [ExtensionWithStatus] {
        extensions.filter { $0.type == "system" }
    }

    private var userExtensions: [ExtensionWithStatus] {
        extensions.filter { $0.type == "user" }
    }

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
            } else if let error {
                ErrorRetryView(message: error) {
                    Task { await loadExtensions() }
                }
            } else {
                List {
                    if !systemExtensions.isEmpty {
                        Section("System Extensions") {
                            ForEach(Array(systemExtensions.enumerated()), id: \.element.id) { index, ext in
                                NavigationLink(value: AppDestination.extensionDetail(
                                    extensionId: ext.id,
                                    assigneeId: nil
                                )) {
                                    ExtensionRowView(extension: ext)
                                }
                                .accessibilityIdentifier("extension-row-\(index)")
                            }
                        }
                    }

                    Section {
                        ForEach(Array(userExtensions.enumerated()), id: \.element.id) { index, ext in
                            NavigationLink(value: AppDestination.extensionDetail(
                                extensionId: ext.id,
                                assigneeId: nil
                            )) {
                                ExtensionRowView(extension: ext)
                            }
                            .accessibilityIdentifier("extension-row-\(systemExtensions.count + index)")
                        }
                        .onDelete(perform: deleteUserExtension)

                        Button {
                            showingAddSheet = true
                        } label: {
                            Label("Add Extension", systemImage: "plus")
                        }
                    } header: {
                        Text("My Extensions")
                    }
                }
            }
        }
        .navigationTitle("Extensions")
        .sheet(isPresented: $showingAddSheet) {
            AddExtensionSheet { _ in
                Task { await loadExtensions() }
            }
        }
        .task {
            await loadExtensions()
        }
        .task {
            for await event in eventManager.stream {
                switch event {
                    case .extensionCreated, .extensionDeleted:
                        await loadExtensions()
                    default:
                        break
                }
            }
        }
    }

    private func loadExtensions() async {
        isLoading = extensions.isEmpty
        error = nil
        do {
            extensions = try await apiClient.listExtensions()
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    private func deleteUserExtension(at offsets: IndexSet) {
        let toDelete = offsets.map { userExtensions[$0] }
        Task {
            for ext in toDelete {
                do {
                    try await apiClient.deleteExtension(id: ext.id)
                    eventManager.emit(.extensionDeleted(ext.id))
                } catch {
                    self.error = error.localizedDescription
                }
            }
        }
    }
}

private struct ExtensionRowView: View {
    let `extension`: ExtensionWithStatus

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: iconName)
                .font(.title3)
                .foregroundStyle(iconColor)
                .frame(width: 32, height: 32)
                .background(iconColor.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 2) {
                Text(`extension`.title)
                    .font(.body)
                if let desc = `extension`.description {
                    Text(desc)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
        .padding(.vertical, 2)
    }

    private var iconName: String {
        switch `extension`.slug {
            case "invoice": "doc.text"
            case "files": "folder"
            case "firecrawl": "globe"
            case "transport": "car"
            default: "puzzlepiece.extension"
        }
    }

    private var iconColor: Color {
        switch `extension`.slug {
            case "invoice": .blue
            case "files": .orange
            case "firecrawl": .red
            case "transport": .green
            default: .purple
        }
    }
}
