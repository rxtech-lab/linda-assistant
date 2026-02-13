import Foundation
import Highlightr
#if canImport(UIKit)
    import UIKit
#endif
#if canImport(AppKit)
    import AppKit
#endif

// MARK: - Syntax Highlighter

@MainActor
final class SyntaxHighlighter {
    static let shared = SyntaxHighlighter()

    private let highlightr: Highlightr?

    private init() {
        highlightr = Highlightr()
        updateTheme()
    }

    func updateTheme() {
        let isDarkMode: Bool
        #if canImport(UIKit)
            isDarkMode = UITraitCollection.current.userInterfaceStyle == .dark
        #elseif canImport(AppKit)
            isDarkMode = NSApp?.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        #else
            isDarkMode = false
        #endif

        highlightr?.setTheme(to: isDarkMode ? "atom-one-dark" : "atom-one-light")
    }

    func highlight(code: String, language: String?) -> NSAttributedString {
        guard let highlightr,
              let highlighted = highlightr.highlight(code, as: language)
        else {
            return NSAttributedString(string: code)
        }
        return highlighted
    }
}
