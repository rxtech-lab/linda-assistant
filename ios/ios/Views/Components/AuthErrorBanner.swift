import SwiftUI
#if os(iOS)
import UIKit
#endif

struct AuthErrorBanner: View {
    let message: String?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shakeOffset: CGFloat = 0
    @State private var previousMessage: String?

    var body: some View {
        if let message {
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.circle.fill")
                    .font(.subheadline)

                Text(message)
                    .font(.subheadline)
                    .multilineTextAlignment(.leading)
            }
            .foregroundStyle(.red)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(Color.red.opacity(0.1))
            )
            .offset(x: shakeOffset)
            .transition(
                reduceMotion
                    ? .opacity
                    : .asymmetric(
                        insertion: .move(edge: .top).combined(with: .opacity),
                        removal: .opacity
                    )
            )
            .onChange(of: message) { oldValue, newValue in
                if oldValue != newValue {
                    triggerShake()
                }
            }
            .onAppear {
                if previousMessage != message {
                    triggerShake()
                    previousMessage = message
                }
            }
        }
    }

    private func triggerShake() {
        guard !reduceMotion else { return }

        #if os(iOS)
        UINotificationFeedbackGenerator().notificationOccurred(.error)
        #endif

        withAnimation(.default) {
            shakeOffset = 8
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {
            withAnimation(.interpolatingSpring(stiffness: 400, damping: 8)) {
                shakeOffset = 0
            }
        }
    }
}
