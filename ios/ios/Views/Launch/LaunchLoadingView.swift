import SwiftUI

struct LaunchLoadingView: View {
    @Environment(\.colorScheme) private var colorScheme
    @State private var showIcon = false
    @State private var showText = false
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
                                Color.black.opacity(0.35)
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .ignoresSafeArea()
            }

            VStack(spacing: 16) {
                Image("appicon", bundle: .main)
                    .resizable()
                    .frame(width: 80, height: 80)
                    .clipShape(RoundedRectangle(cornerRadius: 18))
                    .scaleEffect(showIcon ? 1.0 : 0.5)
                    .opacity(showIcon ? 1.0 : 0.0)

                Text("Linda")
                    .font(.largeTitle)
                    .fontWeight(.bold)
                    .offset(y: showText ? 0 : 12)
                    .opacity(showText ? 1.0 : 0.0)

                ProgressView()
                    .controlSize(.regular)
                    .tint(.primary)
                    .opacity(showSpinner ? (spinnerPulse ? 0.5 : 1.0) : 0.0)
                    .padding(.top, 8)
            }
        }
        .onAppear {
            withAnimation(.spring(response: 0.5, dampingFraction: 0.7).delay(0.15)) {
                showIcon = true
            }
            withAnimation(.easeOut(duration: 0.4).delay(0.4)) {
                showText = true
            }
            withAnimation(.easeIn(duration: 0.3).delay(0.7)) {
                showSpinner = true
            }
            withAnimation(.easeInOut(duration: 0.8).delay(1.0).repeatForever(autoreverses: true)) {
                spinnerPulse = true
            }
        }
    }
}

#Preview {
    LaunchLoadingView()
}
