import AssistantCore
import SwiftUI

struct OnboardingSheetView: View {
    let onComplete: () -> Void

    var body: some View {
        #if os(iOS)
        NavigationStack {
            WelcomeSplashView(onComplete: onComplete)
        }
        #else
        WelcomeSplashView(onContinue: onComplete)
        #endif
    }
}

#Preview {
    OnboardingSheetView(onComplete: {})
        .environment(AuthManager())
        .environment(EventManager())
}
