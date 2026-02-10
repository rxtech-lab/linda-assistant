import SwiftUI

struct AssistantPendingIndicator: View {
    @State private var animating = false

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 4) {
                    ForEach(0..<3, id: \.self) { index in
                        PulsingDot(
                            delay: Double(index) * 0.15,
                            isAnimating: animating
                        )
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .background(Color(UIColor.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 18))
            }

            Spacer(minLength: 60)
        }
        .onAppear { animating = true }
    }
}

struct PulsingDot: View {
    let delay: Double
    let isAnimating: Bool
    
    @State private var scale: CGFloat = 0.4
    @State private var opacity: Double = 0.3
    
    var body: some View {
        Circle()
            .fill(
                LinearGradient(
                    colors: [Color.blue.opacity(0.8), Color.purple.opacity(0.6)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .frame(width: 10, height: 10)
            .scaleEffect(scale)
            .opacity(opacity)
            .onChange(of: isAnimating) { _, newValue in
                if newValue {
                    startAnimation()
                }
            }
            .onAppear {
                if isAnimating {
                    startAnimation()
                }
            }
    }
    
    private func startAnimation() {
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            withAnimation(
                .easeInOut(duration: 0.5)
                .repeatForever(autoreverses: true)
            ) {
                scale = 1.0
                opacity = 1.0
            }
        }
    }
}

// MARK: - Alternative Wave Animation

struct WaveLoadingIndicator: View {
    @State private var phase: CGFloat = 0
    
    var body: some View {
        HStack {
            VStack(alignment: .leading) {
                HStack(spacing: 3) {
                    ForEach(0..<5, id: \.self) { index in
                        WaveBar(
                            index: index,
                            phase: phase
                        )
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(Color(UIColor.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 18))
            }
            
            Spacer(minLength: 60)
        }
        .onAppear {
            withAnimation(
                .linear(duration: 1.2)
                .repeatForever(autoreverses: false)
            ) {
                phase = .pi * 2
            }
        }
    }
}

struct WaveBar: View {
    let index: Int
    let phase: CGFloat
    
    private var height: CGFloat {
        let offset = CGFloat(index) * 0.4
        let sineValue = sin(phase + offset)
        return 8 + (sineValue + 1) * 6
    }
    
    var body: some View {
        RoundedRectangle(cornerRadius: 2)
            .fill(
                LinearGradient(
                    colors: [Color.blue, Color.cyan],
                    startPoint: .bottom,
                    endPoint: .top
                )
            )
            .frame(width: 4, height: height)
            .animation(.easeInOut(duration: 0.1), value: phase)
    }
}

// MARK: - Morphing Dots Animation

struct MorphingDotsIndicator: View {
    @State private var currentIndex = 0
    @State private var timerTask: Task<Void, Never>?
    
    var body: some View {
        HStack {
            VStack(alignment: .leading) {
                HStack(spacing: 6) {
                    ForEach(0..<3, id: \.self) { index in
                        Circle()
                            .fill(
                                index == currentIndex
                                    ? AnyShapeStyle(
                                        LinearGradient(
                                            colors: [Color.indigo, Color.purple],
                                            startPoint: .topLeading,
                                            endPoint: .bottomTrailing
                                        )
                                    )
                                    : AnyShapeStyle(Color.gray.opacity(0.3))
                            )
                            .frame(
                                width: index == currentIndex ? 12 : 8,
                                height: index == currentIndex ? 12 : 8
                            )
                            .animation(.spring(response: 0.3, dampingFraction: 0.6), value: currentIndex)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(Color(UIColor.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 18))
            }
            
            Spacer(minLength: 60)
        }
        .onAppear {
            timerTask = Task {
                while !Task.isCancelled {
                    try? await Task.sleep(for: .milliseconds(300))
                    if !Task.isCancelled {
                        currentIndex = (currentIndex + 1) % 3
                    }
                }
            }
        }
        .onDisappear {
            timerTask?.cancel()
        }
    }
}

// MARK: - Orbit Animation

struct OrbitLoadingIndicator: View {
    @State private var rotation: Double = 0
    
    var body: some View {
        HStack {
            VStack(alignment: .leading) {
                ZStack {
                    // Static center dot
                    Circle()
                        .fill(Color.gray.opacity(0.3))
                        .frame(width: 6, height: 6)
                    
                    // Orbiting dots
                    ForEach(0..<3, id: \.self) { index in
                        Circle()
                            .fill(
                                LinearGradient(
                                    colors: [Color.blue, Color.teal],
                                    startPoint: .leading,
                                    endPoint: .trailing
                                )
                            )
                            .frame(width: 6, height: 6)
                            .offset(x: 10)
                            .rotationEffect(.degrees(rotation + Double(index) * 120))
                            .opacity(0.7 + 0.3 * sin((rotation + Double(index) * 120) * .pi / 180))
                    }
                }
                .frame(width: 32, height: 32)
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
                .background(Color(UIColor.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 18))
            }
            
            Spacer(minLength: 60)
        }
        .onAppear {
            withAnimation(
                .linear(duration: 1.5)
                .repeatForever(autoreverses: false)
            ) {
                rotation = 360
            }
        }
    }
}

// MARK: - Previews

#Preview("Pulsing Dots (Default)") {
    AssistantPendingIndicator()
        .padding()
}

#Preview("Wave Bars") {
    WaveLoadingIndicator()
        .padding()
}

#Preview("Morphing Dots") {
    MorphingDotsIndicator()
        .padding()
}

#Preview("Orbit") {
    OrbitLoadingIndicator()
        .padding()
}

#Preview("All Animations") {
    VStack(spacing: 24) {
        VStack(alignment: .leading, spacing: 8) {
            Text("Pulsing Dots")
                .font(.caption)
                .foregroundStyle(.secondary)
            AssistantPendingIndicator()
        }
        
        VStack(alignment: .leading, spacing: 8) {
            Text("Wave Bars")
                .font(.caption)
                .foregroundStyle(.secondary)
            WaveLoadingIndicator()
        }
        
        VStack(alignment: .leading, spacing: 8) {
            Text("Morphing Dots")
                .font(.caption)
                .foregroundStyle(.secondary)
            MorphingDotsIndicator()
        }
        
        VStack(alignment: .leading, spacing: 8) {
            Text("Orbit")
                .font(.caption)
                .foregroundStyle(.secondary)
            OrbitLoadingIndicator()
        }
    }
    .padding()
}
