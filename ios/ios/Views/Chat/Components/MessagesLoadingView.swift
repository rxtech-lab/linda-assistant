import SwiftUI

struct MessagesLoadingView: View {
    @Environment(\.iconTransitionNamespace) private var iconNamespace
    @State private var bouncing = false

    var body: some View {
        VStack {
            Spacer()
            let icon = Image("appicon", bundle: .main)
                .resizable()
                .frame(width: 80, height: 80)
                .clipShape(RoundedRectangle(cornerRadius: 18))
                .scaleEffect(bouncing ? 0.6 : 1.0)
                .offset(y: bouncing ? 12 : -12)
                .opacity(0.85)

            if let ns = iconNamespace {
                icon.matchedGeometryEffect(id: "appIcon", in: ns)
            } else {
                icon
            }
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear {
            // Delay bounce to let matchedGeometryEffect transition settle first
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                withAnimation(
                    .easeInOut(duration: 0.6)
                        .repeatForever(autoreverses: true)
                ) {
                    bouncing = true
                }
            }
        }
    }
}

#Preview("Messages Loading") {
    MessagesLoadingView()
}

#Preview("Messages Loading - Dark") {
    MessagesLoadingView()
        .preferredColorScheme(.dark)
}
