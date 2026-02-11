import SwiftUI

struct ErrorBannerView: View {
    let message: String
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.white)
                .font(.body)

            Text(message)
                .font(.subheadline)
                .foregroundStyle(.white)
                .lineLimit(2)

            Spacer()

            Button {
                onDismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.white.opacity(0.8))
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(.red, in: RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal, 12)
        .padding(.top, 8)
        .transition(.move(edge: .top).combined(with: .opacity))
    }
}

#Preview("Short Error") {
    VStack {
        ErrorBannerView(message: "Failed to send message") {}
        Spacer()
    }
}

#Preview("Long Error") {
    VStack {
        ErrorBannerView(message: "Database insertion failed: could not create confirmation record for tool call") {}
        Spacer()
    }
}
