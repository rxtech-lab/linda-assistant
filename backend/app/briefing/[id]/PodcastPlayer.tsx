"use client";

import { useEffect, useRef, useState } from "react";

interface PodcastPlayerProps {
  url: string;
}

const RATES = [0.75, 1.0, 1.25, 1.5];

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export default function PodcastPlayer({ url }: PodcastPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1.0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [showRateMenu, setShowRateMenu] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTimeUpdate = () => {
      if (!isScrubbing) setCurrentTime(audio.currentTime);
    };
    const onLoadedMetadata = () => {
      if (Number.isFinite(audio.duration)) setDuration(audio.duration);
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("durationchange", onLoadedMetadata);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("durationchange", onLoadedMetadata);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
    };
  }, [isScrubbing]);

  const togglePlayPause = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  };

  const setPlaybackRate = (r: number) => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = r;
    setRate(r);
    setShowRateMenu(false);
  };

  const handleSeek = (value: number) => {
    setCurrentTime(value);
  };

  const commitSeek = (value: number) => {
    const audio = audioRef.current;
    if (audio) audio.currentTime = value;
    setIsScrubbing(false);
  };

  return (
    <div className="briefing-podcast">
      {/* biome-ignore lint/a11y/useMediaCaption: podcast audio has no caption track */}
      <audio ref={audioRef} src={url} preload="metadata" />
      <div className="briefing-podcast-header">
        <span className="briefing-podcast-label">
          <span aria-hidden="true" style={{ marginRight: 6 }}>
            🎧
          </span>
          Podcast
        </span>
        <div className="briefing-podcast-rate-wrapper">
          <button
            type="button"
            className="briefing-podcast-rate"
            onClick={() => setShowRateMenu((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={showRateMenu}
          >
            {rate.toFixed(2)}×
          </button>
          {showRateMenu ? (
            <div className="briefing-podcast-rate-menu" role="menu">
              {RATES.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="menuitemradio"
                  aria-checked={Math.abs(r - rate) < 0.01}
                  className={`briefing-podcast-rate-option${
                    Math.abs(r - rate) < 0.01 ? " is-active" : ""
                  }`}
                  onClick={() => setPlaybackRate(r)}
                >
                  {r.toFixed(2)}×
                  {Math.abs(r - rate) < 0.01 ? (
                    <span aria-hidden="true"> ✓</span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="briefing-podcast-controls">
        <button
          type="button"
          className="briefing-podcast-play"
          onClick={togglePlayPause}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        <div className="briefing-podcast-progress">
          <input
            type="range"
            min={0}
            max={duration > 0 ? duration : 0.1}
            step={0.1}
            value={currentTime}
            onChange={(e) => handleSeek(Number(e.target.value))}
            onMouseDown={() => setIsScrubbing(true)}
            onTouchStart={() => setIsScrubbing(true)}
            onMouseUp={(e) =>
              commitSeek(Number((e.target as HTMLInputElement).value))
            }
            onTouchEnd={(e) =>
              commitSeek(Number((e.target as HTMLInputElement).value))
            }
            aria-label="Seek"
          />
          <div className="briefing-podcast-times">
            <span>{formatTime(currentTime)}</span>
            <span>{duration > 0 ? formatTime(duration) : "--:--"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
