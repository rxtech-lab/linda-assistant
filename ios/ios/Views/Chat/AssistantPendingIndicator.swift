import SwiftUI

struct AssistantPendingIndicator: View {
    @State private var animating = false

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("Linda")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)

                HStack(spacing: 6) {
                    ForEach(0 ..< 3, id: \.self) { index in
                        Circle()
                            .fill(Color.secondary)
                            .frame(width: 8, height: 8)
                            .scaleEffect(animating ? 1.0 : 0.5)
                            .opacity(animating ? 1.0 : 0.4)
                            .animation(
                                .easeInOut(duration: 0.6)
                                    .repeatForever(autoreverses: true)
                                    .delay(Double(index) * 0.2),
                                value: animating
                            )
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .background(Color(UIColor.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 16))
            }

            Spacer(minLength: 60)
        }
        .onAppear { animating = true }
    }
}

#Preview {
    AssistantPendingIndicator()
        .padding()
}
