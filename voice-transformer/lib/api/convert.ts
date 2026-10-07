import { SERVER_DURATION_TOLERANCE_SECONDS } from "@/lib/audio/constants";
import { probeAudio as defaultProbeAudio, type ProbeAudio } from "@/lib/audio/server-metadata";
import { normalizeMimeType, validateAudioDuration, validateAudioFile } from "@/lib/audio/validation";
import { ElevenLabsVoiceConversionProvider } from "@/lib/elevenlabs/provider";
import { ProviderError, type VoiceConversionProvider } from "@/lib/elevenlabs/types";
import { readServerConfig, type ServerConfig } from "@/lib/server/config";
import { consoleLogger, type Logger } from "@/lib/server/logger";
import { resolveVoice, type EnvSource } from "@/lib/voices/config";
import { CONVERT_FORM_FIELDS, CONVERT_RESPONSE_HEADERS } from "@/types/api";
import { ApiError, apiErrorFromProvider } from "./errors";

// Every check runs before the provider is contacted: configuration, request
// shape, voice allowlist, size, declared format, then the real container and
// duration. Dependencies are injectable so the handler is testable offline.

export type ConvertDependencies = {
  env: EnvSource;
  createProvider: (config: ServerConfig) => VoiceConversionProvider;
  probeAudio: ProbeAudio;
  logger: Logger;
};

export const defaultConvertDependencies: ConvertDependencies = {
  env: process.env,
  createProvider: (config) =>
    new ElevenLabsVoiceConversionProvider({
      apiKey: config.apiKey ?? "",
      modelId: config.modelId,
      outputFormat: config.outputFormat,
      removeBackgroundNoise: config.removeBackgroundNoise,
      timeoutMs: config.providerTimeoutMs,
    }),
  probeAudio: defaultProbeAudio,
  logger: consoleLogger,
};

const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

const UNREADABLE_AUDIO_MESSAGE =
  "We couldn't read this audio file. Make sure it is a valid MP3, WAV, M4A, OGG, FLAC or WebM recording.";

function declaredContentLength(request: Request): number | null {
  const header = request.headers.get("content-length");
  if (!header) return null;
  const parsed = Number(header);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function readMultipart(request: Request): Promise<FormData> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    throw new ApiError(400, "bad-request", "Expected a multipart/form-data upload with an audio file.");
  }
  try {
    return await request.formData();
  } catch {
    throw new ApiError(400, "bad-request", "The upload could not be read. Please try again.");
  }
}

function extractAudioPart(form: FormData): { blob: Blob; name: string } {
  const part = form.get(CONVERT_FORM_FIELDS.audio);
  if (!(part instanceof Blob)) {
    throw new ApiError(400, "missing-audio", "No audio was included in the request. Record or upload audio first.");
  }
  const name = typeof (part as File).name === "string" && (part as File).name ? (part as File).name : "recording";
  return { blob: part, name };
}

function fileTooLarge(limitBytes: number): ApiError {
  const limitMb = Math.round((limitBytes / (1024 * 1024)) * 10) / 10;
  return new ApiError(413, "file-too-large", `This file is too large. The maximum is ${limitMb} MB.`);
}

export async function handleConvertRequest(
  request: Request,
  deps: ConvertDependencies = defaultConvertDependencies,
): Promise<Response> {
  const startedAt = performance.now();
  const { logger } = deps;

  try {
    return await convert(request, deps, startedAt);
  } catch (error) {
    const totalMs = Math.round(performance.now() - startedAt);
    if (error instanceof ApiError) {
      logger.warn("convert.rejected", { status: error.status, code: error.code, totalMs });
      return error.toResponse();
    }
    logger.error("convert.unexpected", {
      totalMs,
      message: error instanceof Error ? error.message : "unknown",
    });
    return new ApiError(500, "internal", "Something went wrong on our side. Please try again.").toResponse();
  }
}

async function convert(request: Request, deps: ConvertDependencies, startedAt: number): Promise<Response> {
  const config = readServerConfig(deps.env);
  if (!config.apiKey) {
    throw new ApiError(
      500,
      "provider-not-configured",
      "The voice service is not configured on this server. Set ELEVENLABS_API_KEY and restart.",
    );
  }

  const { limits } = config;
  const declared = declaredContentLength(request);
  if (declared !== null && declared > limits.maxSizeBytes + MULTIPART_OVERHEAD_BYTES) {
    throw fileTooLarge(limits.maxSizeBytes);
  }

  const form = await readMultipart(request);
  const { blob, name } = extractAudioPart(form);

  const voiceSlug = form.get(CONVERT_FORM_FIELDS.voiceSlug);
  const voice = resolveVoice(voiceSlug, deps.env);
  if (!voice.ok) {
    if (voice.reason === "unknown-slug") {
      throw new ApiError(400, "invalid-voice", "That target voice is not available. Please choose a voice from the list.");
    }
    throw new ApiError(
      400,
      "voice-not-configured",
      "That target voice is not configured on this server. Please choose another voice.",
    );
  }

  const mimeType = normalizeMimeType(blob.type);
  const fileCheck = validateAudioFile({ name, type: mimeType, size: blob.size }, limits);
  if (!fileCheck.ok) {
    if (fileCheck.code === "file-too-large") throw fileTooLarge(limits.maxSizeBytes);
    if (fileCheck.code === "unsupported-format") throw new ApiError(415, "unsupported-format", fileCheck.message);
    throw new ApiError(400, "missing-audio", fileCheck.message);
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const probe = await deps.probeAudio(bytes, mimeType || undefined);
  if (!probe.ok) {
    if (probe.reason === "no-duration") {
      throw new ApiError(
        422,
        "invalid-audio",
        "We couldn't determine how long this audio is. Try exporting it as MP3 or WAV and upload it again.",
      );
    }
    throw new ApiError(415, "unsupported-format", UNREADABLE_AUDIO_MESSAGE);
  }

  const durationCheck = validateAudioDuration(probe.durationSeconds, limits, {
    toleranceSeconds: SERVER_DURATION_TOLERANCE_SECONDS,
  });
  if (!durationCheck.ok) {
    throw new ApiError(422, "audio-too-long", durationCheck.message);
  }

  const sourceDurationSeconds = Math.round(probe.durationSeconds * 100) / 100;
  deps.logger.info("convert.start", {
    voiceSlug: voice.voice.slug,
    sourceBytes: bytes.byteLength,
    sourceDurationSeconds,
    container: probe.container,
  });

  const provider = deps.createProvider(config);
  let result;
  try {
    result = await provider.convert({
      audio: bytes,
      mimeType: mimeType || "application/octet-stream",
      fileName: name,
      voiceId: voice.voiceId,
      signal: request.signal,
    });
  } catch (error) {
    if (error instanceof ProviderError) {
      deps.logger.warn("convert.provider_failed", {
        voiceSlug: voice.voice.slug,
        providerCode: error.code,
        providerStatus: error.providerStatus,
        providerDetail: error.providerCode,
        providerMessage: error.providerMessage,
        sourceDurationSeconds,
        totalMs: Math.round(performance.now() - startedAt),
      });
      throw apiErrorFromProvider(error);
    }
    throw error;
  }

  const totalMs = Math.round(performance.now() - startedAt);
  deps.logger.info("convert.success", {
    voiceSlug: voice.voice.slug,
    sourceDurationSeconds,
    providerMs: result.providerLatencyMs,
    totalMs,
    outputBytes: result.audio.byteLength,
  });

  return new Response(result.audio, {
    status: 200,
    headers: {
      "Content-Type": result.mimeType || "audio/mpeg",
      "Content-Length": String(result.audio.byteLength),
      "Content-Disposition": 'inline; filename="voice-conversion.mp3"',
      "Cache-Control": "no-store",
      [CONVERT_RESPONSE_HEADERS.processingMs]: String(totalMs),
      [CONVERT_RESPONSE_HEADERS.providerMs]: String(result.providerLatencyMs),
      [CONVERT_RESPONSE_HEADERS.sourceDurationSeconds]: String(sourceDurationSeconds),
    },
  });
}
