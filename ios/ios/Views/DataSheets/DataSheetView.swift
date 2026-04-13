import AssistantCore
import SwiftUI

// MARK: - Filter Model

enum FilterOperator: String, CaseIterable, Identifiable {
    case contains
    case equals
    case lessThan = "lt"
    case greaterThan = "gt"
    case lessThanOrEqual = "lte"
    case greaterThanOrEqual = "gte"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .contains: "Contains"
        case .equals: "Equals"
        case .lessThan: "Less than"
        case .greaterThan: "Greater than"
        case .lessThanOrEqual: "Less than or equal"
        case .greaterThanOrEqual: "Greater than or equal"
        }
    }

    var symbol: String {
        switch self {
        case .contains: "~"
        case .equals: "="
        case .lessThan: "<"
        case .greaterThan: ">"
        case .lessThanOrEqual: "<="
        case .greaterThanOrEqual: ">="
        }
    }
}

// MARK: - Identifiable Row Wrapper

struct IdentifiableRow: Identifiable {
    let id: Int // row index as stable identity
    let data: DataSheetRow
}

// MARK: - Identifiable Column Wrapper

struct IdentifiableColumn: Identifiable {
    let name: String
    let type: String
    var id: String { name }
}

// MARK: - View Model

@Observable
@MainActor
final class DataSheetViewModel {
    var showFilterSheet = false
    var triggerExport = false
    var isExporting = false
    var exportFileURL: URL?
    var showShareSheet = false

    // Active filter
    var activeFilterColumn: String?
    var activeFilterOperator: FilterOperator?
    var activeFilterValue: String?

    var hasActiveFilter: Bool {
        activeFilterColumn != nil && activeFilterOperator != nil &&
            !(activeFilterValue ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    func clearFilter() {
        activeFilterColumn = nil
        activeFilterOperator = nil
        activeFilterValue = nil
    }
}

// MARK: - Data Sheet View

/// Full interactive data sheet view with lazy loading, sorting, filtering, and export.
struct DataSheetView: View {
    @Environment(AuthManager.self) private var authManager

    let sheetId: String
    @Bindable var viewModel: DataSheetViewModel

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    @State private var sheet: DataSheet?
    @State private var rows: [IdentifiableRow] = []
    @State private var rawRowCount = 0
    @State private var offset = 0
    @State private var hasMore = true
    @State private var isLoadingInitial = true
    @State private var isLoadingMore = false
    @State private var isReloading = false

    // Sort state
    @State private var sortColumn: String?
    @State private var sortOrder: String = "asc"
    @State private var sortComparator: [KeyPathComparator<IdentifiableRow>] = []

    private let pageSize = 50

    private var identifiableColumns: [IdentifiableColumn] {
        (sheet?.columns ?? []).map { IdentifiableColumn(name: $0.name, type: $0.type) }
    }

    var body: some View {
        VStack(spacing: 0) {
            if isLoadingInitial {
                ProgressView("Loading data sheet...")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let sheet {
                sheetContent(sheet)
            } else {
                ContentUnavailableView(
                    "Not Found",
                    systemImage: "tablecells",
                    description: Text("Data sheet could not be loaded.")
                )
            }
        }
        .task {
            await loadInitial()
        }
        .onChange(of: viewModel.triggerExport) { _, newValue in
            if newValue {
                viewModel.triggerExport = false
                Task { await exportCSV() }
            }
        }
        .sheet(isPresented: $viewModel.showFilterSheet) {
            if let columns = sheet?.columns {
                FilterSheet(
                    columns: columns,
                    selectedColumn: viewModel.activeFilterColumn,
                    selectedOperator: viewModel.activeFilterOperator,
                    filterValue: viewModel.activeFilterValue ?? ""
                ) { column, op, value in
                    viewModel.activeFilterColumn = column
                    viewModel.activeFilterOperator = op
                    viewModel.activeFilterValue = value
                    Task { await resetAndReload() }
                } onClear: {
                    viewModel.clearFilter()
                    Task { await resetAndReload() }
                }
                .presentationDetents([.medium])
            }
        }
    }

    @ViewBuilder
    private func sheetContent(_ sheet: DataSheet) -> some View {
        let columns = identifiableColumns

        VStack(spacing: 0) {
            // Active filter chip
            if viewModel.hasActiveFilter {
                activeFilterBar
            }

            // Table
            if columns.isEmpty {
                ContentUnavailableView(
                    "No Columns",
                    systemImage: "tablecells",
                    description: Text("This data sheet has no column definitions.")
                )
            } else {
                tableView(columns: columns)
                    .overlay {
                        if isReloading {
                            VStack(spacing: 8) {
                                ProgressView()
                                    .controlSize(.large)
                                Text("Loading...")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                            .padding(20)
                            .background(.ultraThinMaterial)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                            .transition(.opacity)
                        }
                    }
            }

            // Footer: row count + load more
            footerBar(sheet)
        }
    }

    // MARK: - Active Filter Bar

    @ViewBuilder
    private var activeFilterBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "line.3.horizontal.decrease")
                .font(.caption)
                .foregroundStyle(.blue)

            if let col = viewModel.activeFilterColumn,
               let op = viewModel.activeFilterOperator,
               let val = viewModel.activeFilterValue
            {
                Text("\(col) \(op.symbol) \(val)")
                    .font(.caption)
                    .foregroundStyle(.primary)
            }

            Spacer()

            Button {
                viewModel.showFilterSheet = true
            } label: {
                Text("Edit")
                    .font(.caption)
                    .foregroundStyle(.blue)
            }

            Button {
                viewModel.clearFilter()
                Task { await resetAndReload() }
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.blue.opacity(0.08))
    }

    // MARK: - Table View

    private let columnWidth: CGFloat = 140

    @ViewBuilder
    private func tableView(columns: [IdentifiableColumn]) -> some View {
        let totalWidth = CGFloat(columns.count) * columnWidth

        ScrollView(.horizontal) {
            VStack(spacing: 0) {
                // Sticky header row
                headerRow(columns: columns, totalWidth: totalWidth)

                Divider()

                // Data rows in vertical scroll
                ScrollView(.vertical) {
                    LazyVStack(spacing: 0) {
                        ForEach(rows) { row in
                            dataRow(row: row, columns: columns, totalWidth: totalWidth)
                                .onAppear {
                                    if row.id >= rows.count - 10, hasMore, !isLoadingMore {
                                        Task { await loadMore() }
                                    }
                                }
                        }

                        if isLoadingMore {
                            HStack {
                                Spacer()
                                ProgressView()
                                    .controlSize(.small)
                                    .padding(.vertical, 12)
                                Spacer()
                            }
                            .frame(width: totalWidth)
                        } else if hasMore {
                            Button {
                                Task { await loadMore() }
                            } label: {
                                Text("Load more...")
                                    .font(.caption)
                                    .foregroundStyle(.blue)
                                    .padding(.vertical, 8)
                            }
                            .frame(width: totalWidth)
                        }
                    }
                }
            }
            .padding(.leading, 12)
        }
    }

    @ViewBuilder
    private func headerRow(columns: [IdentifiableColumn], totalWidth: CGFloat) -> some View {
        HStack(spacing: 0) {
            ForEach(columns) { col in
                Button {
                    if sortColumn == col.name {
                        sortOrder = sortOrder == "asc" ? "desc" : "asc"
                    } else {
                        sortColumn = col.name
                        sortOrder = "asc"
                    }
                    Task { await resetAndReload() }
                } label: {
                    HStack(spacing: 4) {
                        Text(col.name)
                            .font(.caption.bold())
                            .lineLimit(1)

                        if sortColumn == col.name {
                            Image(systemName: sortOrder == "asc" ? "chevron.up" : "chevron.down")
                                .font(.caption2)
                        }
                    }
                    .foregroundStyle(sortColumn == col.name ? .blue : .secondary)
                    .frame(width: columnWidth, alignment: .leading)
                    .padding(.vertical, 10)
                    .padding(.horizontal, 8)
                }
                .buttonStyle(.plain)
            }
        }
        .frame(width: totalWidth)
        .background(.bar)
    }

    @ViewBuilder
    private func dataRow(row: IdentifiableRow, columns: [IdentifiableColumn], totalWidth: CGFloat) -> some View {
        HStack(spacing: 0) {
            ForEach(columns) { col in
                Text(row.data[col.name].flatMap { $0 } ?? "-")
                    .font(.caption)
                    .lineLimit(2)
                    .frame(width: columnWidth, alignment: .leading)
                    .padding(.vertical, 8)
                    .padding(.horizontal, 8)
            }
        }
        .frame(width: totalWidth)
        .background(row.id % 2 == 0 ? Color.clear : Color.secondary.opacity(0.04))
        .overlay(alignment: .bottom) { Divider() }
    }

    // MARK: - Footer

    @ViewBuilder
    private func footerBar(_ sheet: DataSheet) -> some View {
        HStack {
            Text("\(rows.count) of \(sheet.rowCount) rows loaded")
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.bar)
    }

    // MARK: - Data Loading

    private func loadInitial() async {
        isLoadingInitial = true
        do {
            sheet = try await apiClient.getDataSheet(id: sheetId)
            let result = try await apiClient.getDataSheetRows(
                id: sheetId, offset: 0, limit: pageSize,
                sort: sortColumn, order: sortColumn != nil ? sortOrder : nil
            )
            rows = result.data.enumerated().map { IdentifiableRow(id: $0.offset, data: $0.element) }
            rawRowCount = result.data.count
            offset = pageSize
            hasMore = result.pagination.hasMore
        } catch {
            print("[DataSheetView] Failed to load: \(error)")
        }
        isLoadingInitial = false
    }

    private func loadMore() async {
        guard hasMore, !isLoadingMore else { return }
        isLoadingMore = true
        do {
            let filterParam = buildFilterParam()
            let result = try await apiClient.getDataSheetRows(
                id: sheetId, offset: offset, limit: pageSize,
                sort: sortColumn, order: sortColumn != nil ? sortOrder : nil,
                filter: filterParam
            )
            let newRows = result.data.enumerated().map {
                IdentifiableRow(id: rawRowCount + $0.offset, data: $0.element)
            }
            rows.append(contentsOf: newRows)
            rawRowCount += result.data.count
            offset += pageSize
            hasMore = result.pagination.hasMore
        } catch {
            print("[DataSheetView] Failed to load more: \(error)")
        }
        isLoadingMore = false
    }

    private func resetAndReload() async {
        isReloading = true
        offset = 0
        hasMore = true
        isLoadingMore = false
        do {
            let filterParam = buildFilterParam()
            let result = try await apiClient.getDataSheetRows(
                id: sheetId, offset: 0, limit: pageSize,
                sort: sortColumn, order: sortColumn != nil ? sortOrder : nil,
                filter: filterParam
            )
            rows = result.data.enumerated().map { IdentifiableRow(id: $0.offset, data: $0.element) }
            rawRowCount = result.data.count
            offset = pageSize
            hasMore = result.pagination.hasMore
        } catch {
            print("[DataSheetView] Failed to reload: \(error)")
        }
        isReloading = false
    }

    private func buildFilterParam() -> String? {
        guard viewModel.hasActiveFilter,
              let col = viewModel.activeFilterColumn,
              let op = viewModel.activeFilterOperator,
              let val = viewModel.activeFilterValue
        else { return nil }

        let filter: [String: Any] = ["column": col, "operator": op.rawValue, "value": val]
        if let data = try? JSONSerialization.data(withJSONObject: filter),
           let str = String(data: data, encoding: .utf8)
        {
            return str
        }
        return nil
    }

    // MARK: - Export

    private func exportCSV() async {
        viewModel.isExporting = true
        do {
            let data = try await apiClient.exportDataSheetCSV(id: sheetId)
            let safeTitle = (sheet?.title ?? "data")
                .replacingOccurrences(of: "[^a-zA-Z0-9\\-_ ]", with: "", options: .regularExpression)
                .trimmingCharacters(in: .whitespaces)
            let tempURL = FileManager.default.temporaryDirectory
                .appendingPathComponent("\(safeTitle.isEmpty ? "data" : safeTitle).csv")
            try data.write(to: tempURL)
            viewModel.exportFileURL = tempURL
            viewModel.showShareSheet = true
        } catch {
            print("[DataSheetView] Export failed: \(error)")
        }
        viewModel.isExporting = false
    }
}

// MARK: - Filter Bottom Sheet

private struct FilterSheet: View {
    let columns: [DataSheetColumn]
    @State var selectedColumn: String?
    @State var selectedOperator: FilterOperator?
    @State var filterValue: String

    var onApply: (String, FilterOperator, String) -> Void
    var onClear: () -> Void

    @Environment(\.dismiss) private var dismiss

    private var canApply: Bool {
        selectedColumn != nil && selectedOperator != nil &&
            !filterValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Field") {
                    Picker("Column", selection: $selectedColumn) {
                        Text("Select a field").tag(String?.none)
                        ForEach(columns, id: \.name) { col in
                            Text(col.name).tag(Optional(col.name))
                        }
                    }
                    .pickerStyle(.menu)
                }

                Section("Condition") {
                    Picker("Operator", selection: $selectedOperator) {
                        Text("Select a condition").tag(FilterOperator?.none)
                        ForEach(FilterOperator.allCases) { op in
                            Text(op.displayName).tag(Optional(op))
                        }
                    }
                    .pickerStyle(.menu)
                }

                Section("Value") {
                    TextField("Enter value...", text: $filterValue)
                    #if os(iOS)
                        .textInputAutocapitalization(.never)
                    #endif
                        .autocorrectionDisabled()
                }
            }
            .navigationTitle("Filter")
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") {
                            dismiss()
                        }
                    }
                    ToolbarItem(placement: .primaryAction) {
                        Button("Apply") {
                            if let col = selectedColumn, let op = selectedOperator {
                                onApply(col, op, filterValue)
                            }
                            dismiss()
                        }
                        .disabled(!canApply)
                    }

                    #if os(iOS)
                    ToolbarItem(placement: .bottomBar) {
                        if selectedColumn != nil || selectedOperator != nil || !filterValue.isEmpty {
                            Button(role: .destructive) {
                                onClear()
                                dismiss()
                            } label: {
                                Text("Clear Filter")
                                    .frame(maxWidth: .infinity)
                            }
                        }
                    }
                    #else
                    ToolbarItem(placement: .automatic) {
                        if selectedColumn != nil || selectedOperator != nil || !filterValue.isEmpty {
                            Button(role: .destructive) {
                                onClear()
                                dismiss()
                            } label: {
                                Text("Clear Filter")
                            }
                        }
                    }
                    #endif
                }
        }
    }
}
