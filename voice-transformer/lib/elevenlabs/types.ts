/** Bytes backed by a plain ArrayBuffer, so they can be handed straight to Blob/Response. */
export type AudioBytes = Uint8Array<ArrayBuffer>;

export type VoiceConversionInput = {
  audio: AudioBytes;
  mimeType: string;
  fileName: string;
  voiceId: string;
  signal?: AbortSignal;
};

export type VoiceConversionResult = {
  audio: AudioBytes;
  mimeType: string;
  providerLatencyMs: number;
};

export interface VoiceConversionProvider {
  readonly name: string;
  convert(input: VoiceConversionInput): Promise<VoiceConversionResult>;
}

export type ProviderErrorCode =
  | "auth"
  | "permission"
  | "plan-required"
  | "quota"
  | "rate-limit"
  | "voice-not-found"
  | "invalid-audio"
  | "invalid-request"
  | "timeout"
  | "network"
  | "upstream";

/** Provider-neutral failure. `message` is safe to log; user-facing wording is chosen by the API layer. */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly providerStatus: number | null;
  readonly providerCode: string | null;
  /** Provider's own explanation, truncated. Logged server-side, never sent to the browser. */
  readonly providerMessage: string | null;

  constructor(
    code: ProviderErrorCode,
    message: string,
    details: { providerStatus?: number | null; providerCode?: string | null; providerMessage?: string | null } = {},
  ) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.providerStatus = details.providerStatus ?? null;
    this.providerCode = details.providerCode ?? null;
    this.providerMessage = details.providerMessage ? details.providerMessage.slice(0, 200) : null;
  }
}

/** Intended shape for a later paid-plan cloning capability (docs/ROADMAP.md, Phase 2). Not implemented. */
export interface VoiceCloningProvider {
  createVoice(input: {
    name: string;
    samples: AudioBytes[];
    consentConfirmed: true;
  }): Promise<{ voiceId: string }>;
  deleteVoice(input: { voiceId: string }): Promise<void>;
}
