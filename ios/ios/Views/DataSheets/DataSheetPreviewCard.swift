import AssistantCore
import SwiftUI

/// Compact preview card for data sheets embedded in markdown via `{{sheet:id}}`.
/// Shows title, column count, row count, and a mini table preview.
struct DataSheetPreviewCard: View {
    @Environment(AuthManager.self) private var authManager

    let sheetId: String
    var onOpenFullSheet: ((String) -> Void)?

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    @State private var sheet: DataSheet?
    @State private var previewRows: [DataSheetRow] = []
    @State private var isLoading = true

    var body: some View {
        Button {
            onOpenFullSheet?(sheetId)
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                if isLoading {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(.quaternary)
                        .frame(height: 120)
                        .overlay(ProgressView())
                } else if let sheet {
                    // Header: title + metadata
                    HStack {
                        Image(systemName: "tablecells")
                            .foregroundStyle(.blue)
                        Text(sheet.title)
                            .font(.subheadline.bold())
                            .lineLimit(1)
                        Spacer()
                        Text("\(sheet.rowCount) rows")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(.quaternary, in: Capsule())
                    }

                    // Mini table preview
                    if let columns = sheet.columns, !columns.isEmpty {
                        miniTable(columns: columns)
                    }
                } else {
                    HStack {
                        Image(systemName: "tablecells")
                            .foregroundStyle(.secondary)
                        Text("Data sheet unavailable")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .padding(12)
            .background(.background, in: RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(.quaternary, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("dataSheetPreview-\(sheetId)")
        .task {
            await loadData()
        }
    }

    @ViewBuilder
    private func miniTable(columns: [DataSheetColumn]) -> some View {
        let visibleColumns = Array(columns.prefix(4))
        let hasMoreColumns = columns.count > 4

        VStack(spacing: 0) {
            // Header row
            HStack(spacing: 0) {
                ForEach(visibleColumns, id: \.name) { col in
                    Text(col.name)
                        .font(.caption2.bold())
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 4)
                        .padding(.horizontal, 6)
                }
                if hasMoreColumns {
                    Text("...")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .frame(width: 30)
                }
            }
            .background(.quaternary.opacity(0.5))

            Divider()

            // Data rows (max 3 preview rows)
            ForEach(Array(previewRows.prefix(3).enumerated()), id: \.offset) { _, row in
                HStack(spacing: 0) {
                    ForEach(visibleColumns, id: \.name) { col in
                        Text(row[col.name].flatMap { $0 } ?? "-")
                            .font(.caption2)
                            .foregroundStyle(.primary)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, 3)
                            .padding(.horizontal, 6)
                    }
                    if hasMoreColumns {
                        Text("...")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                            .frame(width: 30)
                    }
                }
            }

            if previewRows.isEmpty {
                Text("No data")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .padding(.vertical, 4)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(.quaternary, lineWidth: 0.5)
        )
    }

    private func loadData() async {
        isLoading = true
        do {
            async let sheetTask = apiClient.getDataSheet(id: sheetId)
            async let rowsTask = apiClient.getDataSheetRows(id: sheetId, offset: 0, limit: 5)
            let (loadedSheet, loadedRows) = try await (sheetTask, rowsTask)
            sheet = loadedSheet
            previewRows = loadedRows.data
        } catch {
            print("[DataSheetPreviewCard] Failed to load: \(error)")
        }
        isLoading = false
    }
}
