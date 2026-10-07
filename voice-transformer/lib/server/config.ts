import "server-only";
import { DEFAULT_MAX_DURATION_SECONDS, DEFAULT_MAX_SIZE_MB } from "@/lib/audio/constants";
import type { AudioLimits } from "@/lib/audio/validation";
import type { EnvSource } from "@/lib/voices/config";

export const DEFAULT_MODEL_ID = "eleven_multilingual_sts_v2";
export const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";
const DEFAULT_PROVIDER_TIMEOUT_MS = 45_000;

export type ServerConfig = {
  apiKey: string | null;
  modelId: string;
  outputFormat: string;
  removeBackgroundNoise: boolean;
  providerTimeoutMs: number;
  limits: AudioLimits;
};

function readNumber(value: string | undefined, fallback: number, { min, max }: { min: number; max: number }): number {
  const parsed = Number(value);
  if (!value || !Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function readAudioLimits(env: EnvSource = process.env): AudioLimits {
  return {
    maxDurationSeconds: readNumber(env.MAX_AUDIO_DURATION_SECONDS, DEFAULT_MAX_DURATION_SECONDS, { min: 1, max: 300 }),
    maxSizeBytes: Math.round(readNumber(env.MAX_AUDIO_SIZE_MB, DEFAULT_MAX_SIZE_MB, { min: 0.1, max: 100 }) * 1024 * 1024),
  };
}

export function readServerConfig(env: EnvSource = process.env): ServerConfig {
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  return {
    apiKey: apiKey ? apiKey : null,
    modelId: env.ELEVENLABS_MODEL_ID?.trim() || DEFAULT_MODEL_ID,
    outputFormat: DEFAULT_OUTPUT_FORMAT,
    removeBackgroundNoise: readBoolean(env.ELEVENLABS_REMOVE_BACKGROUND_NOISE, false),
    providerTimeoutMs: readNumber(env.ELEVENLABS_TIMEOUT_MS, DEFAULT_PROVIDER_TIMEOUT_MS, { min: 5_000, max: 120_000 }),
    limits: readAudioLimits(env),
  };
}
