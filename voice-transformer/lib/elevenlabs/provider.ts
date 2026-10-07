import { ELEVENLABS_API_BASE_URL, requestSpeechToSpeech, type FetchLike } from "./client";
import type { VoiceConversionInput, VoiceConversionProvider, VoiceConversionResult } from "./types";

export type ElevenLabsProviderOptions = {
  apiKey: string;
  modelId: string;
  outputFormat: string;
  removeBackgroundNoise: boolean;
  timeoutMs: number;
  fetchImpl?: FetchLike;
  baseUrl?: string;
};

export class ElevenLabsVoiceConversionProvider implements VoiceConversionProvider {
  readonly name = "elevenlabs";
  private readonly options: ElevenLabsProviderOptions;

  constructor(options: ElevenLabsProviderOptions) {
    this.options = options;
  }

  async convert(input: VoiceConversionInput): Promise<VoiceConversionResult> {
    const startedAt = performance.now();
    const response = await requestSpeechToSpeech(
      {
        apiKey: this.options.apiKey,
        voiceId: input.voiceId,
        modelId: this.options.modelId,
        outputFormat: this.options.outputFormat,
        removeBackgroundNoise: this.options.removeBackgroundNoise,
        audio: input.audio,
        mimeType: input.mimeType,
        fileName: input.fileName,
        timeoutMs: this.options.timeoutMs,
        signal: input.signal,
      },
      this.options.fetchImpl ?? fetch,
      this.options.baseUrl ?? ELEVENLABS_API_BASE_URL,
    );
    return {
      audio: response.audio,
      mimeType: response.mimeType,
      providerLatencyMs: Math.round(performance.now() - startedAt),
    };
  }
}
