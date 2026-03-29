import SwiftUI

private struct IconTransitionNamespaceKey: EnvironmentKey {
    static let defaultValue: Namespace.ID? = nil
}

extension EnvironmentValues {
    var iconTransitionNamespace: Namespace.ID? {
        get { self[IconTransitionNamespaceKey.self] }
        set { self[IconTransitionNamespaceKey.self] = newValue }
    }
}
