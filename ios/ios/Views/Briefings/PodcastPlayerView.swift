import AVFoundation
import MediaPlayer
import SwiftUI
import UIKit

/// Audio player for briefing podcast MP3s. Streams via AVPlayer and publishes
/// Now Playing metadata + remote commands so playback surfaces on the lock
/// screen, Control Center, AirPods, and CarPlay.
struct PodcastPlayerView: View {
    let url: URL
    let title: String?
    let imageUrl: String?

    @State private var player: AVPlayer?
    @State private var isPlaying = false
    @State private var currentTime: Double = 0
    @State private var duration: Double = 0
    @State private var isScrubbing = false
    @State private var rate: Float = 1.0
    @State private var timeObserver: Any?
    @State private var artworkImage: UIImage?
    @State private var remoteCommandsInstalled = false

    private let availableRates: [Float] = [0.75, 1.0, 1.25, 1.5]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "headphones")
                    .foregroundStyle(.secondary)
                Text("Podcast")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                Menu {
                    ForEach(availableRates, id: \.self) { r in
                        Button {
                            setRate(r)
                        } label: {
                            HStack {
                                Text(String(format: "%.2f×", r))
                                if abs(r - rate) < 0.01 {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    }
                } label: {
                    Text(String(format: "%.2f×", rate))
                        .font(.subheadline.monospacedDigit())
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.secondary.opacity(0.15))
                        .clipShape(Capsule())
                }
                .accessibilityIdentifier("podcast-rate")
            }

            HStack(spacing: 16) {
                Button {
                    togglePlayPause()
                } label: {
                    Image(systemName: isPlaying ? "pause.circle.fill" : "play.circle.fill")
                        .resizable()
                        .frame(width: 44, height: 44)
                        .foregroundStyle(.tint)
                }
                .accessibilityIdentifier("podcast-play-pause")

                VStack(spacing: 4) {
                    Slider(
                        value: $currentTime,
                        in: 0 ... max(duration, 0.1),
                        onEditingChanged: { editing in
                            isScrubbing = editing
                            if !editing {
                                seek(to: currentTime)
                            }
                        }
                    )
                    .accessibilityIdentifier("podcast-progress")

                    HStack {
                        Text(format(currentTime))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                        Spacer()
                        Text(duration > 0 ? format(duration) : "--:--")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color.secondary.opacity(0.08))
        )
        .onAppear {
            setupPlayer()
        }
        .onDisappear {
            tearDownPlayer()
        }
        .onChange(of: url) { _, _ in
            tearDownPlayer()
            setupPlayer()
        }
    }

    private func setupPlayer() {
        configureAudioSession()

        let item = AVPlayerItem(url: url)
        let p = AVPlayer(playerItem: item)
        p.rate = 0
        player = p

        Task { @MainActor in
            do {
                let assetDuration = try await item.asset.load(.duration)
                let seconds = CMTimeGetSeconds(assetDuration)
                if seconds.isFinite, seconds > 0 {
                    duration = seconds
                    updateNowPlayingInfo()
                }
            } catch {
                // ignore — duration may load later
            }
        }

        let interval = CMTime(seconds: 0.5, preferredTimescale: 600)
        timeObserver = p.addPeriodicTimeObserver(forInterval: interval, queue: .main) { time in
            guard !isScrubbing else { return }
            currentTime = CMTimeGetSeconds(time)
            if duration <= 0,
               let d = p.currentItem?.duration,
               CMTimeGetSeconds(d).isFinite
            {
                duration = CMTimeGetSeconds(d)
            }
            updateNowPlayingElapsed()
        }

        installRemoteCommands()
        loadArtworkIfNeeded()
        updateNowPlayingInfo()
    }

    private func tearDownPlayer() {
        if let observer = timeObserver {
            player?.removeTimeObserver(observer)
        }
        timeObserver = nil
        player?.pause()
        player = nil
        isPlaying = false
        uninstallRemoteCommands()
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    private func togglePlayPause() {
        guard let player else { return }
        if isPlaying {
            player.pause()
            isPlaying = false
        } else {
            player.rate = rate
            isPlaying = true
        }
        updateNowPlayingInfo()
    }

    private func setRate(_ r: Float) {
        rate = r
        if isPlaying {
            player?.rate = r
        }
        updateNowPlayingInfo()
    }

    private func seek(to seconds: Double) {
        guard let player else { return }
        let target = CMTime(seconds: seconds, preferredTimescale: 600)
        player.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero) { _ in
            if isPlaying {
                player.rate = rate
            }
            updateNowPlayingElapsed()
        }
    }

    private func format(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "--:--" }
        let total = Int(seconds)
        let m = total / 60
        let s = total % 60
        return String(format: "%d:%02d", m, s)
    }

    // MARK: - Now Playing / Remote Commands

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .spokenAudio, options: [])
            try session.setActive(true, options: [])
        } catch {
            // Audio session failures are non-fatal; playback may still work in-app.
        }
    }

    private func installRemoteCommands() {
        guard !remoteCommandsInstalled else { return }
        let center = MPRemoteCommandCenter.shared()

        center.playCommand.addTarget { _ in
            guard let p = player, !isPlaying else { return .commandFailed }
            p.rate = rate
            isPlaying = true
            updateNowPlayingInfo()
            return .success
        }

        center.pauseCommand.addTarget { _ in
            guard let p = player, isPlaying else { return .commandFailed }
            p.pause()
            isPlaying = false
            updateNowPlayingInfo()
            return .success
        }

        center.togglePlayPauseCommand.addTarget { _ in
            togglePlayPause()
            return .success
        }

        center.skipForwardCommand.preferredIntervals = [15]
        center.skipForwardCommand.addTarget { _ in
            seek(to: min(currentTime + 15, duration))
            return .success
        }

        center.skipBackwardCommand.preferredIntervals = [15]
        center.skipBackwardCommand.addTarget { _ in
            seek(to: max(currentTime - 15, 0))
            return .success
        }

        center.changePlaybackPositionCommand.addTarget { event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else {
                return .commandFailed
            }
            seek(to: event.positionTime)
            return .success
        }

        remoteCommandsInstalled = true
    }

    private func uninstallRemoteCommands() {
        guard remoteCommandsInstalled else { return }
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.removeTarget(nil)
        center.pauseCommand.removeTarget(nil)
        center.togglePlayPauseCommand.removeTarget(nil)
        center.skipForwardCommand.removeTarget(nil)
        center.skipBackwardCommand.removeTarget(nil)
        center.changePlaybackPositionCommand.removeTarget(nil)
        remoteCommandsInstalled = false
    }

    private func loadArtworkIfNeeded() {
        guard artworkImage == nil,
              let imageUrl,
              let url = URL(string: imageUrl)
        else { return }
        Task.detached { [url] in
            guard let (data, _) = try? await URLSession.shared.data(from: url),
                  let image = UIImage(data: data)
            else { return }
            await MainActor.run {
                artworkImage = image
                updateNowPlayingInfo()
            }
        }
    }

    private func updateNowPlayingInfo() {
        var info: [String: Any] = [:]
        info[MPMediaItemPropertyTitle] = title ?? "Podcast"
        info[MPMediaItemPropertyArtist] = "Linda"
        info[MPMediaItemPropertyAlbumTitle] = "Briefings"
        if duration > 0 {
            info[MPMediaItemPropertyPlaybackDuration] = duration
        }
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentTime
        info[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? rate : 0
        info[MPNowPlayingInfoPropertyDefaultPlaybackRate] = rate
        if let artworkImage {
            info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: artworkImage.size) { _ in
                artworkImage
            }
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func updateNowPlayingElapsed() {
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentTime
        info[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? rate : 0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }
}
