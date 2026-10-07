"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckIcon, DownloadIcon, RefreshIcon } from "@/components/ui/icons";
import { formatBytes } from "@/lib/audio/format";
import type { ResultAudio, SourceAudio } from "@/types/audio";

type ResultPlayerProps = {
  result: ResultAudio;
  source: SourceAudio;
  voiceName: string;
  onReset: () => void;
};

export function ResultPlayer({ result, source, voiceName, onReset }: ResultPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  // Browsers may refuse autoplay after an async request; the visible controls remain the fallback.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => audio.play())
      .then(
        () => {
          if (!cancelled) setAutoplayBlocked(false);
        },
        () => {
          if (!cancelled) setAutoplayBlocked(true);
        },
      );
    return () => {
      cancelled = true;
      audio.pause();
    };
  }, [result.url]);

  const seconds = (result.roundTripMs / 1000).toFixed(1);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-success/40 bg-success-soft p-5" role="status" aria-live="polite">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success text-white">
              <CheckIcon size={16} strokeWidth={3} />
            </span>
            <div>
              <p className="text-base font-semibold">Your transformed voice is ready.</p>
              <p className="text-sm text-muted">
                Rendered as {voiceName} in {seconds}s • MP3 • {formatBytes(result.blob.size)}
              </p>
            </div>
          </div>
        </div>

        <audio
          ref={audioRef}
          controls
          preload="auto"
          src={result.url}
          className="mt-4"
          aria-label={`Transformed audio, ${voiceName}`}
        />
        {autoplayBlocked ? (
          <p className="mt-2 text-xs text-muted">Autoplay was blocked by your browser — press play to listen.</p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-3">
          <a
            href={result.url}
            download={result.downloadName}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <DownloadIcon size={18} />
            Download MP3
          </a>
          <Button variant="secondary" onClick={onReset} leadingIcon={<RefreshIcon size={18} />}>
            Transform another recording
          </Button>
        </div>
      </div>

      <details className="rounded-xl border border-border bg-surface p-4">
        <summary className="cursor-pointer text-sm font-medium">Compare with the original</summary>
        <audio controls preload="metadata" src={source.url} className="mt-3" aria-label="Original audio" />
      </details>
    </div>
  );
}
