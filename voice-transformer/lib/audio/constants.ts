// Limits are enforced in the browser and on the server; the server values can
// be tuned through environment variables.
export const DEFAULT_MAX_DURATION_SECONDS = 30;
export const DEFAULT_MAX_SIZE_MB = 15;

export const RECOMMENDED_DURATION_RANGE = { min: 5, max: 15 } as const;

// A recording the client stopped at exactly 30.0 s can probe as 30.05 s once
// the encoder pads the final frame; allow that much overshoot.
export const SERVER_DURATION_TOLERANCE_SECONDS = 0.5;

export type AudioFormat = {
  extension: string;
  label: string;
  mimeTypes: readonly string[];
};

export const SUPPORTED_AUDIO_FORMATS: readonly AudioFormat[] = [
  { extension: "mp3", label: "MP3", mimeTypes: ["audio/mpeg", "audio/mp3", "audio/mpeg3"] },
  { extension: "wav", label: "WAV", mimeTypes: ["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"] },
  { extension: "m4a", label: "M4A", mimeTypes: ["audio/mp4", "audio/x-m4a", "audio/m4a", "audio/aac"] },
  { extension: "ogg", label: "OGG", mimeTypes: ["audio/ogg", "application/ogg"] },
  { extension: "oga", label: "OGA", mimeTypes: ["audio/ogg"] },
  { extension: "flac", label: "FLAC", mimeTypes: ["audio/flac", "audio/x-flac"] },
  { extension: "webm", label: "WebM", mimeTypes: ["audio/webm", "video/webm"] },
];

export const AUDIO_ACCEPT_ATTRIBUTE = [
  ...new Set(SUPPORTED_AUDIO_FORMATS.flatMap((f) => [`.${f.extension}`, ...f.mimeTypes])),
].join(",");

export const SUPPORTED_FORMAT_LABELS = SUPPORTED_AUDIO_FORMATS.map((f) => f.label).filter(
  (label, index, all) => all.indexOf(label) === index,
);
