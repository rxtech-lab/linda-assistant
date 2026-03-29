import SwiftUI

struct LaunchLoadingView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.iconTransitionNamespace) private var iconNamespace
    @State private var showIcon = false
    @State private var showSpinner = false
    @State private var spinnerPulse = false

    var body: some View {
        ZStack {
            Image("splash-background")
                .resizable()
                .scaledToFill()
                .ignoresSafeArea()

            if colorScheme == .dark {
                Rectangle()
                    .fill(
                        LinearGradient(
                            colors: [
                                Color.black.opacity(0.55),
                                Color.black.opacity(0.35),
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .ignoresSafeArea()
            }

            let icon = Image("appicon", bundle: .main)
                .resizable()
                .frame(width: 80, height: 80)
                .clipShape(RoundedRectangle(cornerRadius: 18))
                .scaleEffect(showIcon ? 1.0 : 0.5)
                .opacity(showIcon ? 1.0 : 0.0)

            if let ns = iconNamespace {
                icon.matchedGeometryEffect(id: "appIcon", in: ns)
            } else {
                icon
            }

            // Spinner below center
            ProgressView()
                .controlSize(.regular)
                .tint(.primary)
                .opacity(showSpinner ? (spinnerPulse ? 0.5 : 1.0) : 0.0)
                .offset(y: 80)
        }
        .onAppear {
            withAnimation(.spring(response: 0.5, dampingFraction: 0.7).delay(0.15)) {
                showIcon = true
            }
            withAnimation(.easeIn(duration: 0.3).delay(0.4)) {
                showSpinner = true
            }
            withAnimation(.easeInOut(duration: 0.8).delay(0.7).repeatForever(autoreverses: true)) {
                spinnerPulse = true
            }
        }
    }
}

#Preview {
    LaunchLoadingView()
}
