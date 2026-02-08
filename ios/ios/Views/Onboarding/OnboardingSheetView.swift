import AssistantCore
import SwiftUI

struct OnboardingSheetView: View {
    let onComplete: () -> Void

    var body: some View {
        NavigationStack {
            WelcomeSplashView(onComplete: onComplete)
        }
    }
}

#Preview {
    OnboardingSheetView(onComplete: {})
        .environment(AuthManager())
        .environment(EventManager())
}
