"use client";

import { useId, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Button } from "@/components/ui/button";
import { SpinnerIcon, UploadIcon } from "@/components/ui/icons";
import { AUDIO_ACCEPT_ATTRIBUTE, SUPPORTED_FORMAT_LABELS } from "@/lib/audio/constants";
import { getAudioDuration } from "@/lib/audio/duration";
import { formatBytes } from "@/lib/audio/format";
import { validateAudioDuration, validateAudioFile, type AudioLimits } from "@/lib/audio/validation";
import { cn } from "@/lib/utils/cn";
import type { UserFacingError } from "@/types/audio";

export type AcceptedUpload = {
  file: File;
  durationSeconds: number;
};

type UploadZoneProps = {
  limits: AudioLimits;
  disabled?: boolean;
  onFileAccepted: (upload: AcceptedUpload) => void;
  onError: (error: UserFacingError) => void;
};

const VALIDATION_TITLES: Record<string, string> = {
  "empty-file": "Empty file",
  "file-too-large": "File is too large",
  "unsupported-format": "Unsupported audio format",
  "audio-too-long": "Recording is too long",
};

export function UploadZone({ limits, disabled, onFileAccepted, onError }: UploadZoneProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [checking, setChecking] = useState(false);

  const handleFile = async (file: File | null | undefined) => {
    if (!file || disabled || checking) return;

    const fileCheck = validateAudioFile({ name: file.name, type: file.type, size: file.size }, limits);
    if (!fileCheck.ok) {
      onError({ code: fileCheck.code, title: VALIDATION_TITLES[fileCheck.code], message: fileCheck.message });
      return;
    }

    setChecking(true);
    try {
      const durationSeconds = await getAudioDuration(file);
      const durationCheck = validateAudioDuration(durationSeconds, limits);
      if (!durationCheck.ok) {
        onError({ code: durationCheck.code, title: VALIDATION_TITLES[durationCheck.code], message: durationCheck.message });
        return;
      }
      onFileAccepted({ file, durationSeconds });
    } catch {
      onError({
        code: "unreadable-audio",
        title: "Couldn't read this file",
        message: "Your browser couldn't decode this audio. Try exporting it as MP3 or WAV and upload it again.",
      });
    } finally {
      setChecking(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    void handleFile(event.target.files?.[0]);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void handleFile(event.dataTransfer.files?.[0]);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!disabled) setDragging(true);
  };

  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={() => setDragging(false)}
      className={cn(
        "flex flex-col items-center gap-4 rounded-xl border border-dashed px-4 py-10 text-center transition-colors",
        dragging ? "border-accent bg-accent-soft" : "border-border bg-surface-muted/60",
        disabled && "opacity-60",
      )}
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft text-accent">
        {checking ? <SpinnerIcon size={28} /> : <UploadIcon size={28} />}
      </div>
      <div className="space-y-1">
        <p className="text-base font-semibold">{checking ? "Checking file…" : "Upload a recording"}</p>
        <p className="text-sm text-muted">Drag and drop an audio file here, or browse from your device.</p>
      </div>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={AUDIO_ACCEPT_ATTRIBUTE}
        onChange={onInputChange}
        disabled={disabled || checking}
        className="sr-only"
      />
      <Button
        size="lg"
        variant="secondary"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || checking}
        leadingIcon={<UploadIcon size={18} />}
        className="min-w-44"
        aria-describedby={`${inputId}-hint`}
      >
        Choose audio file
      </Button>
      <p id={`${inputId}-hint`} className="text-xs text-muted">
        {SUPPORTED_FORMAT_LABELS.join(", ")} • up to {limits.maxDurationSeconds} seconds • max{" "}
        {formatBytes(limits.maxSizeBytes)}
      </p>
    </div>
  );
}
