import MarkdownUI
import SwiftUI
#if canImport(UIKit)
    import UIKit
#endif
#if canImport(AppKit)
    import AppKit
#endif

// MARK: - Code Block View

struct CodeBlockView: View {
    let configuration: CodeBlockConfiguration

    @State private var isCopied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header with language label and copy button
            HStack {
                if let language = configuration.language, !language.isEmpty {
                    Text(language.uppercased())
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Button {
                    copyCode()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: isCopied ? "checkmark" : "doc.on.doc")
                        Text(isCopied ? "Copied" : "Copy")
                    }
                    .font(.caption2)
                    .foregroundStyle(isCopied ? .green : .secondary)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(MarkdownColors.codeHeaderBackground)

            // Code content with syntax highlighting
            ScrollView(.horizontal, showsIndicators: false) {
                HighlightedCodeView(code: configuration.content, language: configuration.language)
                    .padding(12)
            }
        }
        .background(MarkdownColors.codeBlockBackground)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(MarkdownColors.codeBorderColor, lineWidth: 1)
        )
    }

    private func copyCode() {
        let code = configuration.content
        #if canImport(UIKit)
            UIPasteboard.general.string = code
        #elseif canImport(AppKit)
            let pasteboard = NSPasteboard.general
            pasteboard.clearContents()
            pasteboard.setString(code, forType: .string)
        #endif

        withAnimation {
            isCopied = true
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            withAnimation {
                isCopied = false
            }
        }
    }
}

#Preview("Code Block View") {
    ScrollView {
        VStack(spacing: 16) {
            Markdown {
                """
                Here's a Swift function:

                ```swift
                struct User: Codable {
                    let id: Int
                    let name: String
                    let email: String

                    func greet() -> String {
                        return "Hello, \\(name)!"
                    }
                }

                let user = User(id: 1, name: "John", email: "john@example.com")
                print(user.greet())
                ```

                And some JavaScript:

                ```javascript
                const fetchUsers = async () => {
                    const response = await fetch('/api/users');
                    const data = await response.json();
                    return data.users;
                };
                ```
                """
            }
            .markdownTheme(.chat)
        }
        .padding()
    }
}
