import { SUPPORTED_AUDIO_FORMATS, SUPPORTED_FORMAT_LABELS } from "./constants";
import { formatBytes, formatDurationHuman } from "./format";

export type AudioLimits = {
  maxDurationSeconds: number;
  maxSizeBytes: number;
};

export type AudioValidationCode =
  | "empty-file"
  | "file-too-large"
  | "unsupported-format"
  | "audio-too-long";

export type AudioValidationFailure = {
  ok: false;
  code: AudioValidationCode;
  message: string;
};

export type AudioValidationResult = { ok: true } | AudioValidationFailure;

export type FileDescriptor = {
  name: string;
  type: string;
  size: number;
};

export function normalizeMimeType(type: string | null | undefined): string {
  return (type ?? "").split(";")[0].trim().toLowerCase();
}

export function getFileExtension(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  const dot = trimmed.lastIndexOf(".");
  if (dot === -1 || dot === trimmed.length - 1) return "";
  return trimmed.slice(dot + 1).toLowerCase();
}

// Extension or MIME type is enough here: some OSes report no MIME type for
// FLAC/OGA and MediaRecorder blobs have no filename. The server checks the
// real container before spending credits.
export function isSupportedAudio(file: Pick<FileDescriptor, "name" | "type">): boolean {
  const extension = getFileExtension(file.name);
  const mime = normalizeMimeType(file.type);
  return SUPPORTED_AUDIO_FORMATS.some(
    (format) => format.extension === extension || format.mimeTypes.includes(mime),
  );
}

export const UNSUPPORTED_FORMAT_MESSAGE = `This audio format is not supported. Please use ${SUPPORTED_FORMAT_LABELS.join(", ")}.`;

export function validateAudioFile(file: FileDescriptor, limits: AudioLimits): AudioValidationResult {
  if (file.size <= 0) {
    return { ok: false, code: "empty-file", message: "This file is empty. Please choose a recording that contains audio." };
  }
  if (file.size > limits.maxSizeBytes) {
    return {
      ok: false,
      code: "file-too-large",
      message: `This file is too large (${formatBytes(file.size)}). The maximum is ${formatBytes(limits.maxSizeBytes)}.`,
    };
  }
  if (!isSupportedAudio(file)) {
    return { ok: false, code: "unsupported-format", message: UNSUPPORTED_FORMAT_MESSAGE };
  }
  return { ok: true };
}

export function validateAudioDuration(
  durationSeconds: number,
  limits: Pick<AudioLimits, "maxDurationSeconds">,
  options: { toleranceSeconds?: number } = {},
): AudioValidationResult {
  const tolerance = options.toleranceSeconds ?? 0;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return {
      ok: false,
      code: "audio-too-long",
      message: "We couldn't determine how long this audio is. Try exporting it as MP3 or WAV and upload it again.",
    };
  }
  if (durationSeconds > limits.maxDurationSeconds + tolerance) {
    return {
      ok: false,
      code: "audio-too-long",
      message: `This recording is ${formatDurationHuman(durationSeconds)} long. The MVP currently supports up to ${limits.maxDurationSeconds} seconds.`,
    };
  }
  return { ok: true };
}
