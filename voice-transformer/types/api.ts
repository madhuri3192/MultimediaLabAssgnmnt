export type ApiErrorCode =
  | "bad-request"
  | "missing-audio"
  | "invalid-voice"
  | "voice-not-configured"
  | "file-too-large"
  | "unsupported-format"
  | "invalid-audio"
  | "audio-too-long"
  | "quota-exhausted"
  | "rate-limited"
  | "provider-not-configured"
  | "provider-auth"
  | "provider-voice-missing"
  | "provider-permission"
  | "provider-plan-required"
  | "provider-error"
  | "provider-timeout"
  | "internal";

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    message: string;
  };
};

export const CONVERT_RESPONSE_HEADERS = {
  processingMs: "X-Processing-Ms",
  providerMs: "X-Provider-Ms",
  sourceDurationSeconds: "X-Source-Duration-Seconds",
} as const;

export const CONVERT_FORM_FIELDS = {
  audio: "audio",
  voiceSlug: "voiceSlug",
} as const;
