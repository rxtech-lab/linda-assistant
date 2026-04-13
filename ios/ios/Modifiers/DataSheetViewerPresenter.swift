import SwiftUI

/// Presents a `DataSheetViewerSheet` as a sheet.
/// Attach to any view and bind `sheetId` to an optional `String?` state.
struct DataSheetViewerPresenter: ViewModifier {
    @Binding var sheetId: String?

    private var isPresented: Binding<Bool> {
        Binding(
            get: { sheetId != nil },
            set: { if !$0 { sheetId = nil } }
        )
    }

    func body(content: Content) -> some View {
        content.sheet(isPresented: isPresented) {
            DataSheetViewerSheet(sheetId: sheetId ?? "")
        }
    }
}

extension View {
    func dataSheetViewerPresenter(sheetId: Binding<String?>) -> some View {
        modifier(DataSheetViewerPresenter(sheetId: sheetId))
    }
}
