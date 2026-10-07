import { mapElevenLabsHttpError } from "./errors";
import { ProviderError, type AudioBytes } from "./types";

// https://elevenlabs.io/docs/api-reference/speech-to-speech/convert

export const ELEVENLABS_API_BASE_URL = "https://api.elevenlabs.io";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type SpeechToSpeechRequest = {
  apiKey: string;
  voiceId: string;
  modelId: string;
  outputFormat: string;
  removeBackgroundNoise: boolean;
  audio: AudioBytes;
  mimeType: string;
  fileName: string;
  timeoutMs: number;
  signal?: AbortSignal;
};

export type SpeechToSpeechResponse = {
  audio: AudioBytes;
  mimeType: string;
};

export function buildSpeechToSpeechUrl(
  voiceId: string,
  outputFormat: string,
  baseUrl = ELEVENLABS_API_BASE_URL,
): string {
  const url = new URL(`/v1/speech-to-speech/${encodeURIComponent(voiceId)}`, baseUrl);
  url.searchParams.set("output_format", outputFormat);
  return url.toString();
}

export function buildSpeechToSpeechForm(
  request: Pick<SpeechToSpeechRequest, "audio" | "mimeType" | "fileName" | "modelId" | "removeBackgroundNoise">,
): FormData {
  const form = new FormData();
  form.append("audio", new Blob([request.audio], { type: request.mimeType }), request.fileName);
  form.append("model_id", request.modelId);
  if (request.removeBackgroundNoise) form.append("remove_background_noise", "true");
  return form;
}

function combineSignals(timeoutMs: number, external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return external ? AbortSignal.any([timeout, external]) : timeout;
}

export async function requestSpeechToSpeech(
  request: SpeechToSpeechRequest,
  fetchImpl: FetchLike = fetch,
  baseUrl = ELEVENLABS_API_BASE_URL,
): Promise<SpeechToSpeechResponse> {
  const url = buildSpeechToSpeechUrl(request.voiceId, request.outputFormat, baseUrl);
  const body = buildSpeechToSpeechForm(request);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "xi-api-key": request.apiKey, Accept: "audio/mpeg" },
      body,
      signal: combineSignals(request.timeoutMs, request.signal),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new ProviderError("timeout", `ElevenLabs request timed out after ${request.timeoutMs}ms`);
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new ProviderError("network", "ElevenLabs request was aborted");
    }
    throw new ProviderError("network", "Could not reach ElevenLabs");
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw mapElevenLabsHttpError(response.status, bodyText);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const audio = new Uint8Array(await response.arrayBuffer());
  if (audio.byteLength === 0) {
    throw new ProviderError("upstream", "ElevenLabs returned an empty audio response", {
      providerStatus: response.status,
    });
  }
  if (contentType && !contentType.startsWith("audio/")) {
    throw new ProviderError("upstream", `ElevenLabs returned unexpected content-type ${contentType}`, {
      providerStatus: response.status,
    });
  }

  return { audio, mimeType: contentType.split(";")[0] || "audio/mpeg" };
}
