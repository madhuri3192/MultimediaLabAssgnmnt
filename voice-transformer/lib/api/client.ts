import type { VoiceSlug } from "@/lib/voices/config";
import { CONVERT_FORM_FIELDS, CONVERT_RESPONSE_HEADERS, type ApiErrorBody, type ApiErrorCode } from "@/types/api";
import type { ProcessingStep, UserFacingError } from "@/types/audio";

export const CONVERT_ENDPOINT = "/api/convert";

export type ConversionRequest = {
  audio: Blob;
  fileName: string;
  voiceSlug: VoiceSlug;
  signal?: AbortSignal;
  onStep?: (step: ProcessingStep) => void;
};

export type ConversionResponse = {
  blob: Blob;
  processingMs: number | null;
  providerMs: number | null;
};

export class ConversionClientError extends Error {
  readonly code: ApiErrorCode | "network" | "aborted" | "unexpected";
  readonly status: number | null;

  constructor(code: ConversionClientError["code"], message: string, status: number | null = null) {
    super(message);
    this.name = "ConversionClientError";
    this.code = code;
    this.status = status;
  }
}

const ERROR_TITLES: Partial<Record<ConversionClientError["code"], string>> = {
  "quota-exhausted": "Demo usage limit reached",
  "rate-limited": "The voice service is busy",
  "audio-too-long": "Recording is too long",
  "file-too-large": "File is too large",
  "unsupported-format": "Unsupported audio",
  "invalid-audio": "Audio couldn't be processed",
  "provider-not-configured": "Voice service not configured",
  "provider-auth": "Voice service configuration problem",
  "provider-permission": "Voice service configuration problem",
  "provider-plan-required": "Target voice not available on this plan",
  "provider-voice-missing": "Target voice unavailable",
  "provider-timeout": "The voice service timed out",
  "provider-error": "The voice service had a problem",
  network: "Connection problem",
};

export function toUserFacingError(error: unknown): UserFacingError {
  if (error instanceof ConversionClientError) {
    return {
      code: error.code,
      title: ERROR_TITLES[error.code] ?? "Transformation failed",
      message: error.message,
    };
  }
  return {
    code: "unexpected",
    title: "Something went wrong",
    message: "An unexpected error occurred. Please try again.",
  };
}

function readNumberHeader(headers: Headers, name: string): number | null {
  const value = headers.get(name);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function errorFromResponse(response: Response): Promise<ConversionClientError> {
  const text = await response.text().catch(() => "");
  try {
    const body = JSON.parse(text) as Partial<ApiErrorBody>;
    if (body?.error?.code && body.error.message) {
      return new ConversionClientError(body.error.code, body.error.message, response.status);
    }
  } catch {
    // Non-JSON body: the hosting platform rejected the request before the route ran.
  }
  if (response.status === 413) {
    return new ConversionClientError(
      "file-too-large",
      "This file is too large for the server to accept. Try a shorter recording or a compressed format such as MP3.",
      413,
    );
  }
  if (response.status === 504 || response.status === 502) {
    return new ConversionClientError(
      "provider-error",
      "The server did not respond in time. Please try again with a shorter recording.",
      response.status,
    );
  }
  return new ConversionClientError(
    "unexpected",
    `The server returned an unexpected response (${response.status}). Please try again.`,
    response.status,
  );
}

export async function requestConversion(request: ConversionRequest): Promise<ConversionResponse> {
  request.onStep?.("preparing");
  const form = new FormData();
  form.append(CONVERT_FORM_FIELDS.audio, request.audio, request.fileName);
  form.append(CONVERT_FORM_FIELDS.voiceSlug, request.voiceSlug);

  request.onStep?.("transforming");
  let response: Response;
  try {
    response = await fetch(CONVERT_ENDPOINT, {
      method: "POST",
      body: form,
      signal: request.signal,
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ConversionClientError("aborted", "The transformation was cancelled.");
    }
    throw new ConversionClientError(
      "network",
      "We couldn't reach the server. Check your internet connection and try again.",
    );
  }

  if (!response.ok) throw await errorFromResponse(response);

  request.onStep?.("finalizing");
  const blob = await response.blob();
  if (blob.size === 0) {
    throw new ConversionClientError("unexpected", "The server returned empty audio. Please try again.", response.status);
  }

  return {
    blob: blob.type ? blob : new Blob([blob], { type: "audio/mpeg" }),
    processingMs: readNumberHeader(response.headers, CONVERT_RESPONSE_HEADERS.processingMs),
    providerMs: readNumberHeader(response.headers, CONVERT_RESPONSE_HEADERS.providerMs),
  };
}
