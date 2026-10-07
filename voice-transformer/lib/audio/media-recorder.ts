import type { UserFacingError } from "@/types/audio";

export const RECORDING_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg",
] as const;

export function isRecordingSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    typeof window.MediaRecorder === "function" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

export function pickRecordingMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return undefined;
  }
  return RECORDING_MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

export function extensionForMimeType(mimeType: string): string {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  if (base.includes("webm")) return "webm";
  if (base.includes("ogg")) return "ogg";
  if (base.includes("mp4") || base.includes("m4a") || base.includes("aac")) return "m4a";
  if (base.includes("wav")) return "wav";
  if (base.includes("mpeg") || base.includes("mp3")) return "mp3";
  return "webm";
}

export const RECORDING_UNSUPPORTED_ERROR: UserFacingError = {
  code: "recording-unsupported",
  title: "Recording isn't supported in this browser",
  message: "Try a recent version of Chrome, Edge, Firefox or Safari — or switch to Upload and choose an audio file instead.",
};

export function describeMicrophoneError(error: unknown): UserFacingError {
  // DOMExceptions can come from another realm, so avoid instanceof checks.
  const name = typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return {
        code: "microphone-denied",
        title: "Microphone access was blocked",
        message: "Allow microphone access for this site in your browser settings, then press Record again. You can also upload a file instead.",
      };
    case "NotFoundError":
    case "DevicesNotFoundError":
      return {
        code: "microphone-not-found",
        title: "No microphone found",
        message: "Connect a microphone (or check your system's input settings) and try again, or upload an audio file.",
      };
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return {
        code: "microphone-unavailable",
        title: "Microphone is unavailable",
        message: "Another application may be using your microphone. Close it and try again, or upload an audio file.",
      };
    case "SecurityError":
      return {
        code: "microphone-insecure",
        title: "Microphone requires a secure connection",
        message: "Recording only works over HTTPS or on localhost. Open the site over a secure connection or upload a file.",
      };
    case "OverconstrainedError":
      return {
        code: "microphone-constraints",
        title: "Microphone settings unsupported",
        message: "Your microphone doesn't support the requested settings. Try a different input device or upload a file.",
      };
    default:
      return {
        code: "microphone-error",
        title: "Recording couldn't start",
        message: "Something prevented the microphone from starting. Reload the page and try again, or upload a file instead.",
      };
  }
}
