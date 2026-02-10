import SwiftUI

struct StatusBadge: View {
    let status: String

    var body: some View {
        Text(status)
            .font(.caption2.weight(.medium))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.15))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }

    private var color: Color {
        switch status.lowercased() {
        case "pending", "starting": .orange
        case "running", "in_progress": .blue
        case "finished", "stopped": .green
        case "cancelled": .secondary
        case "waiting_confirmation": .purple
        default: .secondary
        }
    }
}
