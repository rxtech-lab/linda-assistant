import AssistantCore
import SwiftUI

struct CategoryTag: View {
    let category: InboxCategory

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: category.iconName)
                .font(.system(size: 9))
            Text(category.displayName)
                .font(.caption2)
                .fontWeight(.medium)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .foregroundStyle(.secondary)
        #if os(iOS)
        .background(Color(.systemGray5))
        #else
        .background(Color.gray.opacity(0.2))
        #endif
        .clipShape(Capsule())
    }
}
