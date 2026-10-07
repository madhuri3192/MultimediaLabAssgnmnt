// The browser only ever sees slugs. Voice IDs stay in server env vars so the
// API key can never be pointed at an arbitrary voice by a client.

export const VOICE_SLUGS = ["warm-narrator", "deep-studio", "bright-conversational"] as const;

export type VoiceSlug = (typeof VOICE_SLUGS)[number];

export type VoiceDefinition = {
  slug: VoiceSlug;
  name: string;
  description: string;
  environmentVariable: string;
};

export type PublicVoice = Pick<VoiceDefinition, "slug" | "name" | "description">;

export const VOICE_DEFINITIONS: readonly VoiceDefinition[] = [
  {
    slug: "warm-narrator",
    name: "Warm Narrator",
    description: "Natural, calm and expressive.",
    environmentVariable: "ELEVENLABS_VOICE_WARM_ID",
  },
  {
    slug: "deep-studio",
    name: "Deep Studio",
    description: "Lower, cinematic delivery.",
    environmentVariable: "ELEVENLABS_VOICE_DEEP_ID",
  },
  {
    slug: "bright-conversational",
    name: "Bright Conversational",
    description: "Friendly, energetic tone.",
    environmentVariable: "ELEVENLABS_VOICE_BRIGHT_ID",
  },
];

export type EnvSource = Record<string, string | undefined>;

const VOICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export function isVoiceSlug(value: unknown): value is VoiceSlug {
  return typeof value === "string" && (VOICE_SLUGS as readonly string[]).includes(value);
}

function readVoiceId(definition: VoiceDefinition, env: EnvSource): string | null {
  const raw = env[definition.environmentVariable]?.trim();
  if (!raw || !VOICE_ID_PATTERN.test(raw)) return null;
  return raw;
}

export function listConfiguredVoices(env: EnvSource = process.env): PublicVoice[] {
  return VOICE_DEFINITIONS.filter((definition) => readVoiceId(definition, env) !== null).map(
    ({ slug, name, description }) => ({ slug, name, description }),
  );
}

export type VoiceResolution =
  | { ok: true; voice: VoiceDefinition; voiceId: string }
  | { ok: false; reason: "unknown-slug" | "not-configured" };

export function resolveVoice(slug: unknown, env: EnvSource = process.env): VoiceResolution {
  if (!isVoiceSlug(slug)) return { ok: false, reason: "unknown-slug" };
  const voice = VOICE_DEFINITIONS.find((definition) => definition.slug === slug);
  if (!voice) return { ok: false, reason: "unknown-slug" };
  const voiceId = readVoiceId(voice, env);
  if (!voiceId) return { ok: false, reason: "not-configured" };
  return { ok: true, voice, voiceId };
}
