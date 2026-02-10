import AssistantCore
import SwiftUI

struct SignInView: View {
    @Environment(AuthManager.self) private var authManager

    var body: some View {
        RxSignInView(
            manager: authManager.oauthManager,
            appearance: RxSignInAppearance(
                icon: .assetImage("appicon", .main),
                title: "Linda",
                subtitle: "Your Personal Assistant",
                signInButtonTitle: "Sign in with RxLab"
            ),
            onAuthFailed: { error in
                print("Auth failed: \(error)")
            }
        )
    }
}
