import { describe, expect, it } from "vitest";
import { isVoiceSlug, listConfiguredVoices, resolveVoice, VOICE_DEFINITIONS } from "./config";

const fullEnv = {
  ELEVENLABS_VOICE_WARM_ID: "warm123456789",
  ELEVENLABS_VOICE_DEEP_ID: "deep123456789",
  ELEVENLABS_VOICE_BRIGHT_ID: "bright1234567",
};

describe("isVoiceSlug", () => {
  it("only accepts known slugs", () => {
    expect(isVoiceSlug("warm-narrator")).toBe(true);
    expect(isVoiceSlug("celebrity-clone")).toBe(false);
    expect(isVoiceSlug(42)).toBe(false);
    expect(isVoiceSlug(null)).toBe(false);
  });
});

describe("listConfiguredVoices", () => {
  it("returns only voices with an ID configured, without exposing the ID", () => {
    const voices = listConfiguredVoices({ ELEVENLABS_VOICE_DEEP_ID: "deep123456789" });
    expect(voices).toEqual([{ slug: "deep-studio", name: "Deep Studio", description: "Lower, cinematic delivery." }]);
    expect(JSON.stringify(voices)).not.toContain("deep123456789");
  });

  it("returns an empty list when nothing is configured", () => {
    expect(listConfiguredVoices({})).toEqual([]);
  });

  it("ignores malformed IDs", () => {
    expect(listConfiguredVoices({ ELEVENLABS_VOICE_WARM_ID: "not a voice id!" })).toEqual([]);
    expect(listConfiguredVoices({ ELEVENLABS_VOICE_WARM_ID: "   " })).toEqual([]);
  });

  it("keeps the declared display order", () => {
    expect(listConfiguredVoices(fullEnv).map((voice) => voice.slug)).toEqual(VOICE_DEFINITIONS.map((voice) => voice.slug));
  });
});

describe("resolveVoice", () => {
  it("resolves a valid slug to the trusted voice ID", () => {
    const result = resolveVoice("warm-narrator", fullEnv);
    expect(result).toMatchObject({ ok: true, voiceId: "warm123456789" });
  });

  it("rejects unknown slugs", () => {
    expect(resolveVoice("../../etc/passwd", fullEnv)).toEqual({ ok: false, reason: "unknown-slug" });
    expect(resolveVoice(undefined, fullEnv)).toEqual({ ok: false, reason: "unknown-slug" });
  });

  it("reports a known slug with no configured ID", () => {
    expect(resolveVoice("bright-conversational", { ELEVENLABS_VOICE_WARM_ID: "warm123456789" })).toEqual({
      ok: false,
      reason: "not-configured",
    });
  });

  it("trims whitespace around configured IDs", () => {
    expect(resolveVoice("deep-studio", { ELEVENLABS_VOICE_DEEP_ID: "  deep123456789 \n" })).toMatchObject({
      ok: true,
      voiceId: "deep123456789",
    });
  });
});
