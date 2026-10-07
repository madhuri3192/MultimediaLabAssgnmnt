"use client";

import { Button } from "@/components/ui/button";
import { MicIcon, SpinnerIcon, StopIcon } from "@/components/ui/icons";
import { useRecorder, type RecordingResult } from "@/hooks/use-recorder";
import { RECOMMENDED_DURATION_RANGE } from "@/lib/audio/constants";
import { formatClock } from "@/lib/audio/format";
import type { UserFacingError } from "@/types/audio";
import { AudioVisualizer } from "./audio-visualizer";

type RecorderProps = {
  maxDurationSeconds: number;
  disabled?: boolean;
  onRecordingStart: () => void;
  onRecordingComplete: (result: RecordingResult) => void;
  onRecordingCancel: () => void;
  onError: (error: UserFacingError) => void;
};

export function Recorder({
  maxDurationSeconds,
  disabled,
  onRecordingStart,
  onRecordingComplete,
  onRecordingCancel,
  onError,
}: RecorderProps) {
  const recorder = useRecorder({
    maxDurationMs: maxDurationSeconds * 1000,
    onStart: onRecordingStart,
    onComplete: onRecordingComplete,
    onError,
  });

  const elapsedSeconds = recorder.elapsedMs / 1000;
  const remainingSeconds = Math.max(0, maxDurationSeconds - elapsedSeconds);
  const isActive = recorder.status === "recording" || recorder.status === "stopping";

  const handleCancel = () => {
    recorder.cancel();
    onRecordingCancel();
  };

  if (!isActive) {
    const requesting = recorder.status === "requesting";
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border bg-surface-muted/60 px-4 py-10 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft text-accent">
          <MicIcon size={28} />
        </div>
        <div className="space-y-1">
          <p className="text-base font-semibold">Record your voice</p>
          <p className="text-sm text-muted">
            Speak naturally — words, timing and emotion are preserved. Your browser will ask for microphone access.
          </p>
        </div>
        <Button
          size="lg"
          onClick={() => void recorder.start()}
          disabled={disabled || requesting}
          leadingIcon={requesting ? <SpinnerIcon size={18} /> : <MicIcon size={18} />}
          className="min-w-44"
        >
          {requesting ? "Waiting for microphone…" : "Record voice"}
        </Button>
        <p className="text-xs text-muted">
          Best results: {RECOMMENDED_DURATION_RANGE.min}–{RECOMMENDED_DURATION_RANGE.max} seconds • Maximum:{" "}
          {maxDurationSeconds} seconds
        </p>
      </div>
    );
  }

  const stopping = recorder.status === "stopping";
  return (
    <div className="flex flex-col gap-5 rounded-xl border border-recording/40 bg-surface-muted/60 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-recording">
          <span aria-hidden="true" className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full rounded-full bg-recording opacity-60 motion-safe:animate-ping" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-recording" />
          </span>
          <span>{stopping ? "Finishing…" : "Recording"}</span>
        </div>
        <p className="tabular-nums text-lg font-semibold" role="timer" aria-label="Recording time">
          {formatClock(elapsedSeconds)} <span className="text-muted">/ {formatClock(maxDurationSeconds)}</span>
        </p>
      </div>

      <AudioVisualizer analyser={recorder.analyser} className="h-16 w-full text-recording" />

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button
          variant="danger"
          size="lg"
          onClick={recorder.stop}
          disabled={stopping}
          leadingIcon={stopping ? <SpinnerIcon size={18} /> : <StopIcon size={18} />}
          className="min-w-44"
        >
          {stopping ? "Stopping…" : "Stop recording"}
        </Button>
        <Button variant="ghost" onClick={handleCancel} disabled={stopping}>
          Discard
        </Button>
      </div>
      <p className="text-center text-xs text-muted">
        {remainingSeconds <= 5
          ? `Stopping automatically in ${Math.ceil(remainingSeconds)}s.`
          : `Stops automatically at ${maxDurationSeconds} seconds.`}
      </p>
    </div>
  );
}
