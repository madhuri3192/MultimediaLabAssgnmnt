"use client";

import { Button } from "@/components/ui/button";
import { RefreshIcon, TrashIcon, WaveIcon } from "@/components/ui/icons";
import { formatBytes, formatDurationHuman } from "@/lib/audio/format";
import type { SourceAudio } from "@/types/audio";

type SourcePreviewProps = {
  source: SourceAudio;
  onDiscard: () => void;
  disabled?: boolean;
  compact?: boolean;
};

export function SourcePreview({ source, onDiscard, disabled, compact }: SourcePreviewProps) {
  const isRecording = source.origin === "recording";
  const title = isRecording ? "Your recording" : source.fileName;

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <WaveIcon size={20} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold" title={title}>
              {title}
            </p>
            <p className="text-xs text-muted">
              {isRecording ? "Original" : "Original upload"} • {formatDurationHuman(source.durationSeconds)} •{" "}
              {formatBytes(source.blob.size)}
            </p>
          </div>
        </div>
        {!compact ? (
          <Button
            variant="ghost"
            onClick={onDiscard}
            disabled={disabled}
            leadingIcon={isRecording ? <RefreshIcon size={16} /> : <TrashIcon size={16} />}
          >
            {isRecording ? "Re-record" : "Remove file"}
          </Button>
        ) : null}
      </div>
      <audio controls preload="metadata" src={source.url} className="mt-3" aria-label={`Preview of ${title}`} />
    </div>
  );
}
