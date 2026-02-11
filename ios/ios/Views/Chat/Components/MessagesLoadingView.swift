import SwiftUI
#if canImport(AppKit)
    import AppKit
#endif

struct MessagesLoadingView: View {
    @State private var visibleRows: Set<Int> = []
    @State private var shimmerOffset: CGFloat = -1.0
    @State private var isShimmering = false

    private let appearDelay: Double = 0.2
    private let disappearDelay: Double = 0.15

    var body: some View {
        GeometryReader { geometry in
            let rowHeight: CGFloat = 80
            let spacing: CGFloat = 16
            let rowCount = Int((geometry.size.height + spacing) / (rowHeight + spacing))

            VStack(alignment: .leading, spacing: spacing) {
                ForEach(0 ..< rowCount, id: \.self) { index in
                    MessageSkeletonRow(
                        isUser: index % 2 == 0,
                        shimmerOffset: isShimmering ? shimmerOffset : -1.0
                    )
                    .frame(height: rowHeight)
                    .opacity(visibleRows.contains(index) ? 1.0 : 0.0)
                    .offset(y: visibleRows.contains(index) ? 0 : 20)
                    .scaleEffect(visibleRows.contains(index) ? 1.0 : 0.95)
                }
            }
            .padding()
            .onAppear {
                startAnimation(rowCount: rowCount)
            }
            .onChange(of: rowCount) { _, newCount in
                // Restart animation if screen size changes
                visibleRows.removeAll()
                isShimmering = false
                shimmerOffset = -1.0
                startAnimation(rowCount: newCount)
            }
        }
    }

    private func startAnimation(rowCount: Int) {
        guard rowCount > 0 else { return }

        // Phase 1: Appear one by one from top to bottom
        for index in 0 ..< rowCount {
            let animation = Animation
                .spring(response: 0.4, dampingFraction: 0.75)
                .delay(Double(index) * appearDelay)
            _ = withAnimation(animation) {
                visibleRows.insert(index)
            }
        }

        // Start shimmer after first row appears
        DispatchQueue.main.asyncAfter(deadline: .now() + appearDelay) {
            isShimmering = true
            let shimmerAnimation = Animation
                .easeInOut(duration: 1.2)
                .repeatForever(autoreverses: false)
            withAnimation(shimmerAnimation) {
                shimmerOffset = 1.0
            }
        }

        // Phase 2: Disappear one by one from top to bottom
        let totalAppearTime = Double(rowCount) * appearDelay + 0.4
        let holdTime = 1.2
        let disappearStart = totalAppearTime + holdTime

        // Stop shimmer before disappearing
        DispatchQueue.main.asyncAfter(deadline: .now() + disappearStart - 0.2) {
            isShimmering = false
        }

        for index in 0 ..< rowCount {
            let animation = Animation
                .easeInOut(duration: 0.35)
                .delay(disappearStart + Double(index) * disappearDelay)
            _ = withAnimation(animation) {
                visibleRows.remove(index)
            }
        }

        // Phase 3: Restart the animation cycle
        let totalCycleTime = disappearStart + Double(rowCount) * disappearDelay + 0.4
        DispatchQueue.main.asyncAfter(deadline: .now() + totalCycleTime) {
            shimmerOffset = -1.0
            startAnimation(rowCount: rowCount)
        }
    }
}

private struct MessageSkeletonRow: View {
    let isUser: Bool
    let shimmerOffset: CGFloat

    var body: some View {
        HStack {
            if isUser {
                Spacer(minLength: 60)
            }

            VStack(alignment: isUser ? .trailing : .leading, spacing: 8) {
                SkeletonLine(width: isUser ? 120 : 150, shimmerOffset: shimmerOffset)
                SkeletonLine(width: isUser ? 180 : 200, shimmerOffset: shimmerOffset)
                if !isUser {
                    SkeletonLine(width: 100, shimmerOffset: shimmerOffset)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(isUser ? Color.orange.opacity(0.15) : skeletonBubbleBackgroundColor)
            )

            if !isUser {
                Spacer(minLength: 60)
            }
        }
    }
}

private struct SkeletonLine: View {
    let width: CGFloat
    let shimmerOffset: CGFloat

    var body: some View {
        RoundedRectangle(cornerRadius: 4)
            .fill(skeletonLineColor)
            .frame(width: width, height: 12)
            .overlay(
                GeometryReader { geometry in
                    RoundedRectangle(cornerRadius: 4)
                        .fill(
                            LinearGradient(
                                colors: [
                                    Color.clear,
                                    Color.white.opacity(0.5),
                                    Color.clear,
                                ],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .frame(width: geometry.size.width * 0.6)
                        .offset(x: geometry.size.width * shimmerOffset)
                }
            )
            .clipShape(RoundedRectangle(cornerRadius: 4))
    }
}

private var skeletonBubbleBackgroundColor: Color {
    #if canImport(UIKit)
        return Color(.systemGray5)
    #elseif canImport(AppKit)
        return Color(nsColor: .windowBackgroundColor).opacity(0.5)
    #else
        return Color.gray.opacity(0.2)
    #endif
}

private var skeletonLineColor: Color {
    #if canImport(UIKit)
        return Color(.systemGray4)
    #elseif canImport(AppKit)
        return Color(nsColor: .separatorColor).opacity(0.6)
    #else
        return Color.gray.opacity(0.3)
    #endif
}

#Preview("Messages Loading") {
    MessagesLoadingView()
}

#Preview("Messages Loading - Dark") {
    MessagesLoadingView()
        .preferredColorScheme(.dark)
}
