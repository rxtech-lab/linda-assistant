import AssistantCore
import SwiftUI

/// Modal sheet wrapper for presenting the full interactive data sheet view.
struct DataSheetViewerSheet: View {
    @Environment(\.dismiss) private var dismiss

    let sheetId: String

    @State private var viewModel = DataSheetViewModel()
    @State private var exportError: String?

    var body: some View {
        NavigationStack {
            DataSheetView(sheetId: sheetId, viewModel: viewModel)
                .overlay {
                    if viewModel.isExporting {
                        VStack(spacing: 12) {
                            ProgressView()
                                .controlSize(.large)
                            Text("Exporting...")
                                .font(.subheadline.weight(.medium))
                        }
                        .padding(24)
                        .background(.ultraThinMaterial)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                    }
                }
                .navigationTitle("Data Sheet")
                #if os(iOS)
                    .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") {
                            dismiss()
                        }
                    }
                    ToolbarItem(placement: .primaryAction) {
                        Menu {
                            Button {
                                viewModel.showFilterSheet = true
                            } label: {
                                Label("Filter", systemImage: "line.3.horizontal.decrease")
                            }

                            Button {
                                viewModel.triggerExport = true
                            } label: {
                                Label("Export CSV", systemImage: "square.and.arrow.down")
                            }
                            .disabled(viewModel.isExporting)
                        } label: {
                            if viewModel.isExporting {
                                ProgressView()
                                    .controlSize(.small)
                            } else {
                                Image(systemName: "ellipsis.circle")
                            }
                        }
                        .disabled(viewModel.isExporting)
                    }
                }
                .alert("Export Error", isPresented: .init(
                    get: { exportError != nil },
                    set: { if !$0 { exportError = nil } }
                )) {
                    Button("OK") { exportError = nil }
                } message: {
                    if let exportError {
                        Text(exportError)
                    }
                }
                #if os(iOS)
                .sheet(isPresented: $viewModel.showShareSheet) {
                    if let url = viewModel.exportFileURL {
                        ActivitySheet(url: url)
                    }
                }
                #endif
        }
    }
}

#if os(iOS)
    private struct ActivitySheet: UIViewControllerRepresentable {
        let url: URL
        func makeUIViewController(context _: Context) -> UIActivityViewController {
            UIActivityViewController(activityItems: [url], applicationActivities: nil)
        }

        func updateUIViewController(_: UIActivityViewController, context _: Context) {}
    }
#endif
