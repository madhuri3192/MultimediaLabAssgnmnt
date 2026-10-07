export type SourceOrigin = "recording" | "upload";

export type SourceAudio = {
  blob: Blob;
  url: string;
  durationSeconds: number;
  mimeType: string;
  fileName: string;
  origin: SourceOrigin;
};

export type ResultAudio = {
  blob: Blob;
  url: string;
  downloadName: string;
  processingMs: number | null;
  providerMs: number | null;
  roundTripMs: number;
};

export type ProcessingStep = "preparing" | "transforming" | "finalizing";

export type UserFacingError = {
  title: string;
  message: string;
  code: string;
};
