import type { ProviderError, ProviderErrorCode } from "@/lib/elevenlabs/types";
import type { ApiErrorBody, ApiErrorCode } from "@/types/api";

// `message` is shown verbatim in the UI: describe a next step, never include
// provider payloads or secrets.
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;

  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }

  toResponse(): Response {
    const body: ApiErrorBody = { error: { code: this.code, message: this.message } };
    return Response.json(body, {
      status: this.status,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

export const PLAN_REQUIRED_MESSAGE =
  "ElevenLabs says this request needs a paid plan. On the free plan that almost always means the configured target voice is a Voice Library voice, which free accounts can't use through the API. Configure a voice you created with Voice Design, or one of ElevenLabs' current built-in default voices, and restart.";

export const QUOTA_EXHAUSTED_MESSAGE =
  "Demo usage limit reached. The free AI processing quota has been exhausted. Please try again after the quota resets.";

const PROVIDER_ERROR_MAP: Record<ProviderErrorCode, { status: number; code: ApiErrorCode; message: string }> = {
  quota: { status: 429, code: "quota-exhausted", message: QUOTA_EXHAUSTED_MESSAGE },
  "rate-limit": {
    status: 429,
    code: "rate-limited",
    message: "The voice service is busy right now. Wait a few seconds and try again.",
  },
  auth: {
    status: 500,
    code: "provider-auth",
    message: "The voice service rejected this application's credentials. The server's ELEVENLABS_API_KEY needs to be checked.",
  },
  "plan-required": {
    status: 500,
    code: "provider-plan-required",
    message: PLAN_REQUIRED_MESSAGE,
  },
  permission: {
    status: 500,
    code: "provider-permission",
    message: "The voice service refused this request for the current account or plan. The server configuration needs to be checked.",
  },
  "voice-not-found": {
    status: 500,
    code: "provider-voice-missing",
    message: "The selected target voice is not available at the voice service. The configured voice ID needs to be checked.",
  },
  "invalid-audio": {
    status: 422,
    code: "invalid-audio",
    message: "The voice service could not process this audio. Try a clearer recording or a different file format.",
  },
  "invalid-request": {
    status: 502,
    code: "provider-error",
    message: "The voice service rejected the request. Please try again with a different recording.",
  },
  timeout: {
    status: 504,
    code: "provider-timeout",
    message: "The voice service took too long to respond. Please try again, ideally with a shorter recording.",
  },
  network: {
    status: 502,
    code: "provider-error",
    message: "We couldn't reach the voice service. Please try again in a moment.",
  },
  upstream: {
    status: 502,
    code: "provider-error",
    message: "The voice service returned an unexpected response. Please try again in a moment.",
  },
};

export function apiErrorFromProvider(error: ProviderError): ApiError {
  const mapped = PROVIDER_ERROR_MAP[error.code];
  return new ApiError(mapped.status, mapped.code, mapped.message);
}
