import SwiftUI
#if canImport(UIKit)
    import UIKit
#endif
#if canImport(AppKit)
    import AppKit
#endif

// MARK: - Markdown Colors

enum MarkdownColors {
    // MARK: - Code Colors

    static var codeInlineBackground: Color {
        #if canImport(UIKit)
            Color(.systemGray5)
        #elseif canImport(AppKit)
            Color(nsColor: .controlBackgroundColor)
        #else
            Color.gray.opacity(0.2)
        #endif
    }

    static var codeBlockBackground: Color {
        #if canImport(UIKit)
            Color(.systemGray6)
        #elseif canImport(AppKit)
            Color(nsColor: .textBackgroundColor).opacity(0.5)
        #else
            Color.gray.opacity(0.1)
        #endif
    }

    static var codeHeaderBackground: Color {
        #if canImport(UIKit)
            Color(.systemGray5)
        #elseif canImport(AppKit)
            Color(nsColor: .separatorColor).opacity(0.3)
        #else
            Color.gray.opacity(0.15)
        #endif
    }

    static var codeBorderColor: Color {
        #if canImport(UIKit)
            Color(.separator).opacity(0.5)
        #elseif canImport(AppKit)
            Color(nsColor: .separatorColor).opacity(0.5)
        #else
            Color.gray.opacity(0.2)
        #endif
    }

    // MARK: - Table Colors

    static var tableHeaderBackground: Color {
        #if canImport(UIKit)
            Color(.systemGray5)
        #elseif canImport(AppKit)
            Color(nsColor: .controlBackgroundColor)
        #else
            Color.gray.opacity(0.15)
        #endif
    }

    static var tableAlternateRowBackground: Color {
        #if canImport(UIKit)
            Color(.systemGray6)
        #elseif canImport(AppKit)
            Color(nsColor: .controlBackgroundColor).opacity(0.3)
        #else
            Color.gray.opacity(0.05)
        #endif
    }

    static var tableBorderColor: Color {
        #if canImport(UIKit)
            Color(.separator)
        #elseif canImport(AppKit)
            Color(nsColor: .separatorColor)
        #else
            Color.gray.opacity(0.3)
        #endif
    }
}

#Preview("Markdown Colors") {
    VStack(spacing: 16) {
        Group {
            HStack {
                Text("Code Inline BG")
                Spacer()
                RoundedRectangle(cornerRadius: 4)
                    .fill(MarkdownColors.codeInlineBackground)
                    .frame(width: 40, height: 24)
            }
            HStack {
                Text("Code Block BG")
                Spacer()
                RoundedRectangle(cornerRadius: 4)
                    .fill(MarkdownColors.codeBlockBackground)
                    .frame(width: 40, height: 24)
            }
            HStack {
                Text("Code Header BG")
                Spacer()
                RoundedRectangle(cornerRadius: 4)
                    .fill(MarkdownColors.codeHeaderBackground)
                    .frame(width: 40, height: 24)
            }
            HStack {
                Text("Code Border")
                Spacer()
                RoundedRectangle(cornerRadius: 4)
                    .fill(MarkdownColors.codeBorderColor)
                    .frame(width: 40, height: 24)
            }
        }

        Divider()

        Group {
            HStack {
                Text("Table Header BG")
                Spacer()
                RoundedRectangle(cornerRadius: 4)
                    .fill(MarkdownColors.tableHeaderBackground)
                    .frame(width: 40, height: 24)
            }
            HStack {
                Text("Table Alt Row BG")
                Spacer()
                RoundedRectangle(cornerRadius: 4)
                    .fill(MarkdownColors.tableAlternateRowBackground)
                    .frame(width: 40, height: 24)
            }
            HStack {
                Text("Table Border")
                Spacer()
                RoundedRectangle(cornerRadius: 4)
                    .fill(MarkdownColors.tableBorderColor)
                    .frame(width: 40, height: 24)
            }
        }
    }
    .padding()
}
