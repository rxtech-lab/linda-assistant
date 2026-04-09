import AssistantCore
import SwiftUI

struct UserUploadSheetView: View {
    let uploadManager: FileUploadManager
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                ForEach(uploadManager.selectedFiles) { file in
                    fileRow(file: file)
                }
            }
            .navigationTitle("Attached Files")
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") { dismiss() }
                    }
                }
        }
    }

    @ViewBuilder
    private func fileRow(file: SelectedUploadFile) -> some View {
        let state = uploadManager.uploadStates[file.id] ?? .pending

        HStack(spacing: 12) {
            // Thumbnail or icon
            if file.isImage, let uiImage = platformImage(from: file.data) {
                Image(platformImage: uiImage)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .frame(width: 44, height: 44)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            } else {
                Image(systemName: iconForExtension(file.extension_))
                    .font(.title2)
                    .foregroundStyle(.teal)
                    .frame(width: 44, height: 44)
            }

            // File info
            VStack(alignment: .leading, spacing: 2) {
                Text(file.name)
                    .font(.subheadline)
                    .lineLimit(1)

                statusText(for: state)
            }

            Spacer()

            // Actions
            actionButton(for: state, fileId: file.id)
        }
        .padding(.vertical, 4)

        // Progress bar
        if case let .uploading(progress) = state {
            ProgressView(value: progress)
                .tint(.teal)
        }
    }

    @ViewBuilder
    private func statusText(for state: UploadFileState) -> some View {
        switch state {
            case .pending:
                Text("Waiting...")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            case let .uploading(progress):
                Text("Uploading \(Int(progress * 100))%")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            case .completed:
                Text("Ready")
                    .font(.caption)
                    .foregroundStyle(.green)
            case let .failed(error):
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .lineLimit(1)
        }
    }

    @ViewBuilder
    private func actionButton(for state: UploadFileState, fileId: String) -> some View {
        switch state {
            case .pending, .uploading:
                EmptyView()
            case .completed:
                Button {
                    uploadManager.removeFile(id: fileId)
                } label: {
                    Image(systemName: "trash")
                        .foregroundStyle(.red)
                }
                .buttonStyle(.plain)
            case .failed:
                HStack(spacing: 12) {
                    Button {
                        uploadManager.retryFile(id: fileId)
                    } label: {
                        Image(systemName: "arrow.clockwise")
                            .foregroundStyle(.blue)
                    }
                    .buttonStyle(.plain)

                    Button {
                        uploadManager.removeFile(id: fileId)
                    } label: {
                        Image(systemName: "trash")
                            .foregroundStyle(.red)
                    }
                    .buttonStyle(.plain)
                }
        }
    }

    private func iconForExtension(_ ext: String) -> String {
        switch ext.lowercased() {
            case "jpg", "jpeg", "png", "gif", "webp", "heic", "heif": "photo"
            case "pdf": "doc.richtext"
            case "doc", "docx": "doc.text"
            case "xls", "xlsx", "csv": "tablecells"
            case "txt", "md": "doc.plaintext"
            default: "doc"
        }
    }

    #if canImport(UIKit)
        private func platformImage(from data: Data) -> UIImage? {
            UIImage(data: data)
        }

        private struct ImageWrapper: View {
            let image: UIImage
            var body: some View {
                Image(uiImage: image)
                    .resizable()
            }
        }

    #elseif canImport(AppKit)
        private func platformImage(from data: Data) -> NSImage? {
            NSImage(data: data)
        }

        private struct ImageWrapper: View {
            let image: NSImage
            var body: some View {
                Image(nsImage: image)
                    .resizable()
            }
        }
    #endif
}

#if canImport(UIKit)
    private extension Image {
        init(platformImage: UIImage) {
            self.init(uiImage: platformImage)
        }
    }

#elseif canImport(AppKit)
    private extension Image {
        init(platformImage: NSImage) {
            self.init(nsImage: platformImage)
        }
    }
#endif
