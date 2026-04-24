import Kingfisher
import SwiftUI
#if os(iOS)
    import Photos
    import UIKit
#else
    import AppKit
#endif

struct ImageViewerView: View {
    let imageURL: URL

    @State private var scale: CGFloat = 1.0
    @State private var lastScale: CGFloat = 1.0
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero
    @State private var isDownloading = false
    @State private var alertMessage: ImageViewerAlert?
    #if os(iOS)
        @State private var shareURL: URL?
        @State private var showShareSheet = false
    #endif

    var body: some View {
        GeometryReader { geometry in
            KFImage(imageURL)
                .placeholder {
                    ProgressView()
                        .frame(
                            width: geometry.size.width,
                            height: geometry.size.height
                        )
                }
            #if os(iOS)
                .onFailureImage(UIImage(systemName: "photo.badge.exclamationmark"))
            #endif
                .resizable()
                .aspectRatio(contentMode: .fit)
                .scaleEffect(scale)
                .offset(offset)
                .gesture(
                    MagnifyGesture()
                        .onChanged { value in
                            let newScale = lastScale * value.magnification
                            scale = min(max(newScale, 1.0), 5.0)
                        }
                        .onEnded { _ in
                            lastScale = scale
                            if scale <= 1.0 {
                                withAnimation {
                                    offset = .zero
                                    lastOffset = .zero
                                }
                            }
                        }
                        .simultaneously(
                            with: DragGesture()
                                .onChanged { value in
                                    if scale > 1.0 {
                                        let maxOffset = geometry.size.width * (scale - 1) / 2
                                        let newWidth = lastOffset.width + value.translation.width
                                        let newHeight = lastOffset.height + value.translation.height
                                        offset = CGSize(
                                            width: min(max(newWidth, -maxOffset), maxOffset),
                                            height: min(max(newHeight, -maxOffset), maxOffset)
                                        )
                                    }
                                }
                                .onEnded { _ in
                                    lastOffset = offset
                                }
                        )
                )
                .onTapGesture(count: 2) {
                    withAnimation {
                        if scale > 1.0 {
                            scale = 1.0
                            lastScale = 1.0
                            offset = .zero
                            lastOffset = .zero
                        } else {
                            scale = 3.0
                            lastScale = 3.0
                        }
                    }
                }
                .frame(
                    width: geometry.size.width,
                    height: geometry.size.height
                )
        }
        .background(.black)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                downloadMenu
            }
        }
        #if os(iOS)
        .sheet(isPresented: $showShareSheet) {
            if let url = shareURL {
                ImageShareSheet(url: url)
            }
        }
        #endif
        .alert(item: $alertMessage) { message in
            Alert(
                title: Text(message.title),
                message: Text(message.body),
                dismissButton: .default(Text("OK"))
            )
        }
    }

    @ViewBuilder
    private var downloadMenu: some View {
        Menu {
            #if os(iOS)
                Button {
                    Task { await saveToPhotos() }
                } label: {
                    Label("Save to Photos", systemImage: "photo.on.rectangle")
                }
            #endif
            Button {
                Task { await saveToFiles() }
            } label: {
                Label("Save to Files", systemImage: "folder")
            }
        } label: {
            if isDownloading {
                ProgressView()
            } else {
                Image(systemName: "arrow.down")
                    .font(.body.weight(.semibold))
                #if os(iOS)
                    .foregroundStyle(.white)
                #endif
            }
        }
        .disabled(isDownloading)
    }

    // MARK: - Download

    private func downloadImageData() async throws -> (Data, String) {
        let (data, response) = try await URLSession.shared.data(from: imageURL)
        return (data, suggestedFilename(for: response))
    }

    private func suggestedFilename(for response: URLResponse) -> String {
        if let suggested = response.suggestedFilename, !suggested.isEmpty, suggested.contains(".") {
            return suggested
        }
        let last = imageURL.lastPathComponent
        if !last.isEmpty, last.contains(".") {
            return last
        }
        let ext = fileExtension(forMime: response.mimeType ?? "")
        let baseName = last.isEmpty ? "image" : last
        return "\(baseName).\(ext)"
    }

    private func fileExtension(forMime mime: String) -> String {
        switch mime.lowercased() {
            case "image/png": "png"
            case "image/jpeg", "image/jpg": "jpg"
            case "image/gif": "gif"
            case "image/webp": "webp"
            case "image/heic": "heic"
            case "image/heif": "heif"
            default: "jpg"
        }
    }

    #if os(iOS)
        private func saveToPhotos() async {
            isDownloading = true
            defer { isDownloading = false }
            do {
                let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
                guard status == .authorized || status == .limited else {
                    alertMessage = ImageViewerAlert(
                        title: "Permission Needed",
                        body: "Allow photo library access in Settings to save images."
                    )
                    return
                }
                let (data, _) = try await downloadImageData()
                try await PHPhotoLibrary.shared().performChanges {
                    let request = PHAssetCreationRequest.forAsset()
                    request.addResource(with: .photo, data: data, options: nil)
                }
                alertMessage = ImageViewerAlert(title: "Saved", body: "Image saved to Photos.")
            } catch {
                alertMessage = ImageViewerAlert(
                    title: "Failed to Save",
                    body: error.localizedDescription
                )
            }
        }
    #endif

    private func saveToFiles() async {
        isDownloading = true
        defer { isDownloading = false }
        do {
            let (data, filename) = try await downloadImageData()
            #if os(iOS)
                let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
                try? FileManager.default.removeItem(at: tempURL)
                try data.write(to: tempURL)
                shareURL = tempURL
                showShareSheet = true
            #else
                let panel = NSSavePanel()
                panel.nameFieldStringValue = filename
                panel.canCreateDirectories = true
                if panel.runModal() == .OK, let dest = panel.url {
                    try data.write(to: dest)
                }
            #endif
        } catch {
            alertMessage = ImageViewerAlert(
                title: "Failed to Save",
                body: error.localizedDescription
            )
        }
    }
}

private struct ImageViewerAlert: Identifiable {
    let id = UUID()
    let title: String
    let body: String
}

#if os(iOS)
    private struct ImageShareSheet: UIViewControllerRepresentable {
        let url: URL

        func makeUIViewController(context _: Context) -> UIActivityViewController {
            UIActivityViewController(activityItems: [url], applicationActivities: nil)
        }

        func updateUIViewController(_: UIActivityViewController, context _: Context) {}
    }
#endif
