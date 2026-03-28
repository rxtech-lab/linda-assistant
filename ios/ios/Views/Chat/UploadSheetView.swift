import AssistantCore
import os
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

private let logger = Logger(subsystem: "lindaAssistant", category: "UploadSheetView")

struct UploadSheetView: View {
    let upload: UploadRequestPayload
    let remainingCount: Int
    let onComplete: ([String]) -> Void
    let onReject: () -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(AuthManager.self) private var authManager

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    @State private var selectedFiles: [SelectedFile] = []
    @State private var isUploading = false
    @State private var uploadComplete = false
    @State private var uploadedKeys: [String] = []
    @State private var uploadError: String?
    @State private var showDocumentPicker = false
    @State private var showPhotoPicker = false
    @State private var showCamera = false
    @State private var photoSelection: [PhotosPickerItem] = []
    @State private var fileProgress: [Int: Double] = [:]
    @State private var currentUploadIndex: Int?

    private var canSubmit: Bool {
        if isUploading { return false }
        if let expected = upload.numberUploads {
            return selectedFiles.count == expected
        }
        return !selectedFiles.isEmpty
    }

    // MARK: - Upload Complete View

    private var uploadCompleteView: some View {
        UploadCompletionView(
            uploadId: upload.uploadId,
            uploadedKeys: uploadedKeys,
            onDone: { onComplete(uploadedKeys) }
        )
    }

    // MARK: - Upload Form View

    private var headerSection: some View {
        VStack(spacing: 8) {
            Image(systemName: "arrow.up.doc.fill")
                .font(.system(size: 36))
                .foregroundStyle(.teal)

            Text(upload.title)
                .font(.headline)
                .multilineTextAlignment(.center)

            if let description = upload.description {
                Text(description)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            Group {
                if let count = upload.numberUploads {
                    Text("\(count) file\(count == 1 ? "" : "s") expected")
                } else {
                    Text("Upload one or more files")
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding(.top, 2)

            if remainingCount > 0 {
                Text("\(remainingCount) more upload\(remainingCount == 1 ? "" : "s") after this")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.top, 24)
        .padding(.horizontal, 20)
    }

    private var addFileMenu: some View {
        Menu {
            Button {
                showDocumentPicker = true
            } label: {
                Label("Choose Files", systemImage: "doc.fill")
            }

            Button {
                showPhotoPicker = true
            } label: {
                Label("Choose from Photos", systemImage: "photo.on.rectangle")
            }

            #if os(iOS)
                Button {
                    showCamera = true
                } label: {
                    Label("Take Photo", systemImage: "camera.fill")
                }
            #endif
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "plus.circle.fill")
                    .font(.title3)
                Text("Add File")
                    .font(.subheadline.weight(.medium))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            #if os(iOS)
                .background(Color(.secondarySystemGroupedBackground))
            #else
                .background(Color(nsColor: .controlBackgroundColor))
            #endif
                .foregroundStyle(remainingSlots > 0 ? .teal : .secondary)
                .clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .disabled(remainingSlots <= 0)
        .padding(.horizontal, 20)
    }

    private var selectedFilesSection: some View {
        Group {
            if !selectedFiles.isEmpty {
                Divider().padding(.vertical, 16)

                VStack(alignment: .leading, spacing: 8) {
                    Text("Selected Files (\(selectedFiles.count)\(upload.numberUploads.map { "/\($0)" } ?? ""))")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.secondary)

                    ForEach(Array(selectedFiles.enumerated()), id: \.offset) { index, file in
                        selectedFileRow(file: file, index: index)
                    }
                }
                .padding(.horizontal, 20)
            }
        }
    }

    private func selectedFileRow(file: SelectedFile, index: Int) -> some View {
        VStack(spacing: 4) {
            HStack {
                Image(systemName: iconForExtension(file.extension_))
                    .foregroundStyle(.teal)
                Text(file.name)
                    .font(.subheadline)
                    .lineLimit(1)
                Spacer()
                if let progress = fileProgress[index] {
                    if progress >= 1.0 {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                            .font(.subheadline)
                    } else {
                        Text("\(Int(progress * 100))%")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                    }
                } else if !isUploading {
                    Button {
                        selectedFiles.remove(at: index)
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                }
            }
            if let progress = fileProgress[index], progress < 1.0 {
                ProgressView(value: progress)
                    .tint(.teal)
            }
        }
        .padding(.vertical, 4)
    }

    private var validationMessages: some View {
        Group {
            if let expected = upload.numberUploads, selectedFiles.count != expected, !selectedFiles.isEmpty {
                Text("Please select exactly \(expected) file\(expected == 1 ? "" : "s")")
                    .font(.caption)
                    .foregroundStyle(.red)
                    .padding(.top, 8)
            }

            if let error = uploadError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .padding(.top, 8)
                    .padding(.horizontal, 20)
            }
        }
    }

    private var actionButtons: some View {
        VStack(spacing: 12) {
            Button {
                Task { await uploadFiles() }
            } label: {
                HStack {
                    if isUploading {
                        ProgressView()
                            .tint(.white)
                            .padding(.trailing, 4)
                    }
                    Text(isUploading ? "Uploading..." : "Upload")
                        .font(.headline)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(canSubmit ? Color.teal : Color.gray.opacity(0.3))
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .disabled(!canSubmit)

            Button {
                onReject()
            } label: {
                Text("Skip")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 24)
    }

    private var uploadFormView: some View {
        VStack(spacing: 0) {
            headerSection
            Divider().padding(.vertical, 16)
            addFileMenu
            selectedFilesSection
            validationMessages
            Spacer()
            actionButtons
        }
        #if os(iOS)
        .background(Color(.systemGroupedBackground).ignoresSafeArea())
        #else
        .background(Color(nsColor: .windowBackgroundColor).ignoresSafeArea())
        #endif
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                }
            }
        }
    }

    var body: some View {
        NavigationStack {
            if uploadComplete {
                uploadCompleteView
            } else {
                uploadFormView
            }
        }
        .interactiveDismissDisabled(isUploading)
        .photosPicker(
            isPresented: $showPhotoPicker,
            selection: $photoSelection,
            maxSelectionCount: remainingSlots,
            matching: .images
        )
        .onChange(of: photoSelection) {
            Task { await handlePhotoSelection() }
        }
        #if os(iOS)
        .sheet(isPresented: $showDocumentPicker) {
            DocumentPickerView(
                allowedTypes: allowedUTTypes,
                allowMultiple: remainingSlots > 1,
                onPick: { urls in
                    for url in urls.prefix(remainingSlots) {
                        let ext = url.pathExtension.lowercased()
                        if let data = try? Data(contentsOf: url) {
                            selectedFiles.append(SelectedFile(
                                name: url.lastPathComponent,
                                extension_: ext,
                                data: data
                            ))
                        }
                    }
                }
            )
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPickerView { image in
                if let data = image.jpegData(compressionQuality: 0.85) {
                    selectedFiles.append(SelectedFile(
                        name: "photo_\(selectedFiles.count + 1).jpg",
                        extension_: "jpg",
                        data: data
                    ))
                }
            }
            .ignoresSafeArea()
        }
        #endif
    }

    private var hasImageExtensions: Bool {
        // Wildcard accepts all types including images
        if upload.extensions.contains("*") { return true }
        let imageExts = Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "heif"])
        return upload.extensions.contains { imageExts.contains($0.lowercased()) }
    }

    private var remainingSlots: Int {
        if let expected = upload.numberUploads {
            return max(0, expected - selectedFiles.count)
        }
        return .max
    }

    private var allowedUTTypes: [UTType] {
        if upload.extensions.contains("*") {
            return [.item]
        }
        return upload.extensions.compactMap { ext in
            UTType(filenameExtension: ext.lowercased())
        }
    }

    private func handlePhotoSelection() async {
        for item in photoSelection.prefix(remainingSlots) {
            if let data = try? await item.loadTransferable(type: Data.self) {
                await MainActor.run {
                    selectedFiles.append(SelectedFile(
                        name: "photo_\(selectedFiles.count + 1).jpg",
                        extension_: "jpg",
                        data: data
                    ))
                }
            }
        }
        await MainActor.run {
            photoSelection = []
        }
    }

    private func uploadFiles() async {
        guard canSubmit else { return }

        await MainActor.run {
            isUploading = true
            uploadError = nil
            fileProgress = [:]
        }

        var uploadedKeys: [String] = []

        do {
            // Request presigned URLs with actual file extensions
            let extensions = selectedFiles.map(\.extension_)
            let urlItems = try await apiClient.getUploadPresignedUrls(
                id: upload.uploadId,
                extensions: extensions
            )

            for (index, file) in selectedFiles.enumerated() {
                guard index < urlItems.count else { break }
                let urlItem = urlItems[index]

                await MainActor.run {
                    currentUploadIndex = index
                    fileProgress[index] = 0.0
                }

                var request = URLRequest(url: URL(string: urlItem.url)!)
                request.httpMethod = "PUT"
                request.setValue(
                    mimeTypeForExtension(file.extension_),
                    forHTTPHeaderField: "Content-Type"
                )

                let totalBytes = Int64(file.data.count)
                let delegate = UploadProgressDelegate { bytesSent in
                    Task { @MainActor in
                        fileProgress[index] = totalBytes > 0
                            ? Double(bytesSent) / Double(totalBytes)
                            : 1.0
                    }
                }
                let session = URLSession(configuration: .default, delegate: delegate, delegateQueue: nil)
                let (_, response) = try await session.upload(for: request, from: file.data)
                session.invalidateAndCancel()

                guard let httpResponse = response as? HTTPURLResponse,
                      (200 ... 299).contains(httpResponse.statusCode)
                else {
                    throw UploadError.uploadFailed(index: index)
                }

                await MainActor.run { fileProgress[index] = 1.0 }
                uploadedKeys.append(urlItem.key)
            }

            logger.info("S3 upload complete, keys=\(uploadedKeys). Resolving upload id=\(upload.uploadId)")

            // Resolve the upload on the backend before showing completion view
            let resolveBody = ResolveUpload(action: "complete", uploadedKeys: uploadedKeys)
            let resolveResponse = try await apiClient.resolveUpload(id: upload.uploadId, resolveBody)
            logger.info("Upload resolved: action=\(resolveResponse.action) uploadId=\(resolveResponse.uploadId)")

            await MainActor.run {
                isUploading = false
                self.uploadedKeys = uploadedKeys
                withAnimation { uploadComplete = true }
            }
        } catch {
            logger.error("Upload failed: \(error.localizedDescription)")
            await MainActor.run {
                isUploading = false
                uploadError = "Upload failed: \(error.localizedDescription)"
            }
        }
    }

    private func iconForExtension(_ ext: String) -> String {
        switch ext.lowercased() {
            case "jpg", "jpeg", "png", "gif", "webp", "heic", "heif": "photo"
            case "pdf": "doc.richtext"
            case "doc", "docx": "doc.text"
            case "xls", "xlsx", "csv": "tablecells"
            case "mp3", "wav": "waveform"
            case "mp4", "mov": "film"
            default: "doc"
        }
    }

    private func mimeTypeForExtension(_ ext: String) -> String {
        switch ext.lowercased() {
            case "jpg", "jpeg": "image/jpeg"
            case "png": "image/png"
            case "gif": "image/gif"
            case "webp": "image/webp"
            case "heic": "image/heic"
            case "pdf": "application/pdf"
            case "doc": "application/msword"
            case "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            case "csv": "text/csv"
            case "txt": "text/plain"
            default: "application/octet-stream"
        }
    }
}

// MARK: - Supporting Types

private struct SelectedFile {
    let name: String
    let extension_: String
    let data: Data
}

private enum UploadError: LocalizedError {
    case uploadFailed(index: Int)

    var errorDescription: String? {
        switch self {
            case let .uploadFailed(index):
                "Failed to upload file \(index + 1)"
        }
    }
}

// MARK: - Upload Progress Delegate

private final class UploadProgressDelegate: NSObject, URLSessionTaskDelegate {
    let onProgress: (Int64) -> Void

    init(onProgress: @escaping (Int64) -> Void) {
        self.onProgress = onProgress
    }

    func urlSession(
        _: URLSession,
        task _: URLSessionTask,
        didSendBodyData _: Int64,
        totalBytesSent: Int64,
        totalBytesExpectedToSend _: Int64
    ) {
        onProgress(totalBytesSent)
    }
}

// MARK: - Document Picker

#if os(iOS)
    struct DocumentPickerView: UIViewControllerRepresentable {
        let allowedTypes: [UTType]
        let allowMultiple: Bool
        let onPick: ([URL]) -> Void

        func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: allowedTypes)
            picker.allowsMultipleSelection = allowMultiple
            picker.delegate = context.coordinator
            return picker
        }

        func updateUIViewController(_: UIDocumentPickerViewController, context _: Context) {}

        func makeCoordinator() -> Coordinator {
            Coordinator(onPick: onPick)
        }

        class Coordinator: NSObject, UIDocumentPickerDelegate {
            let onPick: ([URL]) -> Void

            init(onPick: @escaping ([URL]) -> Void) {
                self.onPick = onPick
            }

            func documentPicker(_: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
                onPick(urls)
            }
        }
    }

    struct CameraPickerView: UIViewControllerRepresentable {
        @Environment(\.dismiss) private var dismiss
        let onCapture: (UIImage) -> Void

        func makeUIViewController(context: Context) -> UIImagePickerController {
            let picker = UIImagePickerController()
            picker.sourceType = .camera
            picker.delegate = context.coordinator
            return picker
        }

        func updateUIViewController(_: UIImagePickerController, context _: Context) {}

        func makeCoordinator() -> Coordinator {
            Coordinator(onCapture: onCapture, dismiss: dismiss)
        }

        class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
            let onCapture: (UIImage) -> Void
            let dismiss: DismissAction

            init(onCapture: @escaping (UIImage) -> Void, dismiss: DismissAction) {
                self.onCapture = onCapture
                self.dismiss = dismiss
            }

            func imagePickerController(
                _: UIImagePickerController,
                didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
            ) {
                if let image = info[.originalImage] as? UIImage {
                    onCapture(image)
                }
                dismiss()
            }

            func imagePickerControllerDidCancel(_: UIImagePickerController) {
                dismiss()
            }
        }
    }
#endif
