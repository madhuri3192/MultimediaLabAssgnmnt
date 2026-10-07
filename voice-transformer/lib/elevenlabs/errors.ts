import { ProviderError, type ProviderErrorCode } from "./types";

// ElevenLabs errors carry both a legacy `detail.status` (e.g. quota_exceeded)
// and a newer `detail.code` (e.g. insufficient_credits); both are matched.
// https://elevenlabs.io/docs/eleven-api/resources/errors

export type ElevenLabsErrorDetail = {
  status: string | null;
  code: string | null;
  message: string | null;
};

export function parseElevenLabsErrorBody(bodyText: string): ElevenLabsErrorDetail {
  const empty: ElevenLabsErrorDetail = { status: null, code: null, message: null };
  if (!bodyText) return empty;
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (!parsed || typeof parsed !== "object") return empty;
    const detail = (parsed as { detail?: unknown }).detail;
    if (typeof detail === "string") return { ...empty, message: detail };
    if (!detail || typeof detail !== "object") return empty;
    const record = detail as Record<string, unknown>;
    const pick = (key: string) => (typeof record[key] === "string" ? (record[key] as string) : null);
    return { status: pick("status"), code: pick("code"), message: pick("message") };
  } catch {
    return { ...empty, message: bodyText.slice(0, 200) };
  }
}

const QUOTA_IDENTIFIERS = new Set(["quota_exceeded", "insufficient_credits", "character_limit_exceeded"]);
const RATE_LIMIT_IDENTIFIERS = new Set([
  "too_many_concurrent_requests",
  "concurrent_limit_exceeded",
  "rate_limit_exceeded",
  "system_busy",
]);
const VOICE_IDENTIFIERS = new Set(["voice_not_found", "invalid_voice_id", "voice_access_denied"]);
// On the free plan this is almost always a Voice Library voice, which cannot
// be used through the API.
const PLAN_IDENTIFIERS = new Set([
  "paid_plan_required",
  "free_users_not_allowed",
  "subscription_required",
  "feature_not_available",
]);
const PERMISSION_IDENTIFIERS = new Set([
  "missing_permissions",
  "insufficient_permissions",
  "detected_unusual_activity",
  "model_access_denied",
  "forbidden",
]);
const AUDIO_IDENTIFIERS = new Set([
  "invalid_audio",
  "invalid_audio_format",
  "audio_too_long",
  "audio_too_short",
  "invalid_file_type",
  "invalid_content",
]);

function classify(status: number, detail: ElevenLabsErrorDetail): ProviderErrorCode {
  const identifiers = [detail.code, detail.status].filter((value): value is string => Boolean(value));
  const has = (set: Set<string>) => identifiers.some((id) => set.has(id));

  if (has(QUOTA_IDENTIFIERS)) return "quota";
  if (has(RATE_LIMIT_IDENTIFIERS)) return "rate-limit";
  if (has(VOICE_IDENTIFIERS)) return "voice-not-found";
  if (has(PLAN_IDENTIFIERS)) return "plan-required";
  if (has(PERMISSION_IDENTIFIERS)) return "permission";
  if (has(AUDIO_IDENTIFIERS)) return "invalid-audio";

  if (status === 401) return "auth";
  if (status === 402) return "quota";
  if (status === 403) return "permission";
  if (status === 404) return "voice-not-found";
  if (status === 429) return "rate-limit";
  if (status === 400 || status === 422) return "invalid-request";
  if (status === 408 || status === 504) return "timeout";
  return "upstream";
}

export function mapElevenLabsHttpError(status: number, bodyText: string): ProviderError {
  const detail = parseElevenLabsErrorBody(bodyText);
  const code = classify(status, detail);
  const providerCode = detail.code ?? detail.status;
  const summary = providerCode ? `${status} ${providerCode}` : `${status}`;
  return new ProviderError(code, `ElevenLabs request failed (${summary})`, {
    providerStatus: status,
    providerCode,
    providerMessage: detail.message,
  });
}
