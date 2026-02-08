import AssistantCore
import SwiftUI

struct SignInView: View {
    @Environment(AuthManager.self) private var authManager

    var body: some View {
        RxSignInView(
            manager: authManager.oauthManager,
            appearance: RxSignInAppearance(
                icon: .systemImage("bubble.left.and.bubble.right.fill"),
                title: "Linda",
                subtitle: "Your Personal Assistant",
                signInButtonTitle: "Sign in with RxLab"
            )
        )
    }
}
