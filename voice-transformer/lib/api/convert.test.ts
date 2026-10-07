import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AudioProbe } from "@/lib/audio/server-metadata";
import { ProviderError, type VoiceConversionProvider } from "@/lib/elevenlabs/types";
import { silentLogger } from "@/lib/server/logger";
import type { ApiErrorBody } from "@/types/api";
import { handleConvertRequest, type ConvertDependencies } from "./convert";

const API_KEY = "sk-super-secret-key-1234567890";
const VOICE_ID = "warmvoice1234567";

const env = {
  ELEVENLABS_API_KEY: API_KEY,
  ELEVENLABS_VOICE_WARM_ID: VOICE_ID,
};

const fixture = (name: string) => readFileSync(join(process.cwd(), "tests", "fixtures", name));

function makeRequest(parts: { audio?: Blob | string; audioName?: string; voiceSlug?: string }, headers: Record<string, string> = {}) {
  const form = new FormData();
  if (parts.audio !== undefined) {
    if (typeof parts.audio === "string") form.append("audio", parts.audio);
    else form.append("audio", parts.audio, parts.audioName ?? "recording.webm");
  }
  if (parts.voiceSlug !== undefined) form.append("voiceSlug", parts.voiceSlug);
  return new Request("http://localhost/api/convert", { method: "POST", body: form, headers });
}

const okProbe = (durationSeconds: number): AudioProbe => ({ ok: true, durationSeconds, container: "EBML/webm", codec: "OPUS" });

function makeDeps(overrides: Partial<ConvertDependencies> & { convert?: VoiceConversionProvider["convert"] } = {}) {
  const convert =
    overrides.convert ??
    vi.fn(async () => ({ audio: new Uint8Array([0xff, 0xfb, 0x90, 0x00]), mimeType: "audio/mpeg", providerLatencyMs: 42 }));
  const provider: VoiceConversionProvider = { name: "mock", convert };
  const createProvider = vi.fn(() => provider);
  const deps: ConvertDependencies = {
    env,
    createProvider,
    probeAudio: vi.fn(async () => okProbe(5)),
    logger: silentLogger,
    ...overrides,
  };
  return { deps, convert, createProvider };
}

async function readError(response: Response): Promise<ApiErrorBody["error"]> {
  const body = (await response.json()) as ApiErrorBody;
  return body.error;
}

const webmBlob = () => new Blob([fixture("tone-2s-live.webm")], { type: "audio/webm;codecs=opus" });

describe("POST /api/convert", () => {
  it("returns MP3 bytes with no-store headers on success", async () => {
    const { deps, convert } = makeDeps();
    const response = await handleConvertRequest(makeRequest({ audio: webmBlob(), voiceSlug: "warm-narrator" }), deps);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-provider-ms")).toBe("42");
    expect(response.headers.get("x-source-duration-seconds")).toBe("5");
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([0xff, 0xfb, 0x90, 0x00]);

    expect(convert).toHaveBeenCalledTimes(1);
    const input = (convert as ReturnType<typeof vi.fn>).mock.calls[0][0] as { voiceId: string; mimeType: string; fileName: string };
    expect(input.voiceId).toBe(VOICE_ID);
    expect(input.mimeType).toBe("audio/webm");
    expect(input.fileName).toBe("recording.webm");
  });

  it("rejects non-multipart requests", async () => {
    const { deps, convert } = makeDeps();
    const request = new Request("http://localhost/api/convert", {
      method: "POST",
      body: JSON.stringify({ voiceSlug: "warm-narrator" }),
      headers: { "content-type": "application/json" },
    });
    const response = await handleConvertRequest(request, deps);
    expect(response.status).toBe(400);
    expect((await readError(response)).code).toBe("bad-request");
    expect(convert).not.toHaveBeenCalled();
  });

  it("rejects requests without an audio file", async () => {
    const { deps, convert } = makeDeps();
    const response = await handleConvertRequest(makeRequest({ audio: "not-a-file", voiceSlug: "warm-narrator" }), deps);
    expect(response.status).toBe(400);
    expect((await readError(response)).code).toBe("missing-audio");
    expect(convert).not.toHaveBeenCalled();
  });

  it("rejects unknown voice slugs before touching the provider", async () => {
    const { deps, convert, createProvider } = makeDeps();
    const response = await handleConvertRequest(makeRequest({ audio: webmBlob(), voiceSlug: "elvis" }), deps);
    expect(response.status).toBe(400);
    expect((await readError(response)).code).toBe("invalid-voice");
    expect(createProvider).not.toHaveBeenCalled();
    expect(convert).not.toHaveBeenCalled();
  });

  it("rejects a known voice that is not configured", async () => {
    const { deps, convert } = makeDeps();
    const response = await handleConvertRequest(makeRequest({ audio: webmBlob(), voiceSlug: "deep-studio" }), deps);
    expect(response.status).toBe(400);
    expect((await readError(response)).code).toBe("voice-not-configured");
    expect(convert).not.toHaveBeenCalled();
  });

  it("fails safely when the API key is missing", async () => {
    const { deps, convert } = makeDeps({ env: { ELEVENLABS_VOICE_WARM_ID: VOICE_ID } });
    const response = await handleConvertRequest(makeRequest({ audio: webmBlob(), voiceSlug: "warm-narrator" }), deps);
    expect(response.status).toBe(500);
    expect((await readError(response)).code).toBe("provider-not-configured");
    expect(convert).not.toHaveBeenCalled();
  });

  it("rejects oversized uploads by declared content-length without reading the body", async () => {
    const { deps, convert } = makeDeps({ env: { ...env, MAX_AUDIO_SIZE_MB: "1" } });
    const request = makeRequest({ audio: webmBlob(), voiceSlug: "warm-narrator" }, { "content-length": String(3 * 1024 * 1024) });
    const response = await handleConvertRequest(request, deps);
    expect(response.status).toBe(413);
    expect((await readError(response)).code).toBe("file-too-large");
    expect(convert).not.toHaveBeenCalled();
  });

  it("rejects oversized files by actual size", async () => {
    const { deps, convert } = makeDeps({ env: { ...env, MAX_AUDIO_SIZE_MB: "0.1" } });
    const big = new Blob([new Uint8Array(200 * 1024)], { type: "audio/wav" });
    const response = await handleConvertRequest(makeRequest({ audio: big, audioName: "big.wav", voiceSlug: "warm-narrator" }), deps);
    expect(response.status).toBe(413);
    expect(convert).not.toHaveBeenCalled();
  });

  it("rejects unsupported declared formats", async () => {
    const { deps, convert } = makeDeps();
    const pdf = new Blob([new Uint8Array(100)], { type: "application/pdf" });
    const response = await handleConvertRequest(makeRequest({ audio: pdf, audioName: "doc.pdf", voiceSlug: "warm-narrator" }), deps);
    expect(response.status).toBe(415);
    expect((await readError(response)).code).toBe("unsupported-format");
    expect(convert).not.toHaveBeenCalled();
  });

  it("rejects files whose bytes are not real audio, even with an audio extension", async () => {
    const { deps, convert } = makeDeps({ probeAudio: vi.fn(async () => ({ ok: false, reason: "unparseable" }) as AudioProbe) });
    const fake = new Blob([new Uint8Array(500).fill(0x41)], { type: "audio/mpeg" });
    const response = await handleConvertRequest(makeRequest({ audio: fake, audioName: "fake.mp3", voiceSlug: "warm-narrator" }), deps);
    expect(response.status).toBe(415);
    expect(convert).not.toHaveBeenCalled();
  });

  it("rejects audio whose duration cannot be determined", async () => {
    const { deps, convert } = makeDeps({ probeAudio: vi.fn(async () => ({ ok: false, reason: "no-duration" }) as AudioProbe) });
    const response = await handleConvertRequest(makeRequest({ audio: webmBlob(), voiceSlug: "warm-narrator" }), deps);
    expect(response.status).toBe(422);
    expect((await readError(response)).code).toBe("invalid-audio");
    expect(convert).not.toHaveBeenCalled();
  });

  it("accepts the 30 second boundary and rejects longer audio", async () => {
    const boundary = makeDeps({ probeAudio: vi.fn(async () => okProbe(30)) });
    expect((await handleConvertRequest(makeRequest({ audio: webmBlob(), voiceSlug: "warm-narrator" }), boundary.deps)).status).toBe(200);

    const tooLong = makeDeps({ probeAudio: vi.fn(async () => okProbe(31)) });
    const response = await handleConvertRequest(makeRequest({ audio: webmBlob(), voiceSlug: "warm-narrator" }), tooLong.deps);
    expect(response.status).toBe(422);
    const error = await readError(response);
    expect(error.code).toBe("audio-too-long");
    expect(error.message).toContain("31 seconds");
    expect(tooLong.convert).not.toHaveBeenCalled();
  });

  it("uses the real probe to reject a 31 second WebM recording", async () => {
    const { deps, convert } = makeDeps({ probeAudio: (await import("@/lib/audio/server-metadata")).probeAudio });
    const long = new Blob([fixture("tone-31s-live.webm")], { type: "audio/webm" });
    const response = await handleConvertRequest(makeRequest({ audio: long, voiceSlug: "warm-narrator" }), deps);
    expect(response.status).toBe(422);
    expect(convert).not.toHaveBeenCalled();
  });

  it.each([
    ["quota", 429, "quota-exhausted"],
    ["rate-limit", 429, "rate-limited"],
    ["auth", 500, "provider-auth"],
    ["voice-not-found", 500, "provider-voice-missing"],
    ["permission", 500, "provider-permission"],
    ["plan-required", 500, "provider-plan-required"],
    ["invalid-audio", 422, "invalid-audio"],
    ["timeout", 504, "provider-timeout"],
    ["network", 502, "provider-error"],
    ["upstream", 502, "provider-error"],
  ] as const)("maps provider failure %s to %s %s", async (providerCode, status, apiCode) => {
    const { deps } = makeDeps({
      convert: vi.fn(async () => {
        throw new ProviderError(providerCode, `ElevenLabs request failed (${API_KEY})`, { providerStatus: 401 });
      }),
    });
    const response = await handleConvertRequest(makeRequest({ audio: webmBlob(), voiceSlug: "warm-narrator" }), deps);
    expect(response.status).toBe(status);
    const error = await readError(response);
    expect(error.code).toBe(apiCode);
    expect(error.message.length).toBeGreaterThan(10);
    expect(JSON.stringify(error)).not.toContain(API_KEY);
  });

  it("explains a plan restriction instead of calling it an exhausted quota", async () => {
    const { deps } = makeDeps({
      convert: vi.fn(async () => {
        throw new ProviderError("plan-required", "402 paid_plan_required", {
          providerStatus: 402,
          providerCode: "paid_plan_required",
          providerMessage: "Free users cannot use library voices via the API.",
        });
      }),
    });
    const response = await handleConvertRequest(makeRequest({ audio: webmBlob(), voiceSlug: "warm-narrator" }), deps);
    expect(response.status).toBe(500);
    const error = await readError(response);
    expect(error.code).toBe("provider-plan-required");
    expect(error.message).toContain("Voice Library");
    expect(error.message).not.toContain("quota");
  });

  it("shows the demo quota message when credits are exhausted", async () => {
    const { deps } = makeDeps({
      convert: vi.fn(async () => {
        throw new ProviderError("quota", "quota");
      }),
    });
    const response = await handleConvertRequest(makeRequest({ audio: webmBlob(), voiceSlug: "warm-narrator" }), deps);
    expect((await readError(response)).message).toContain("Demo usage limit reached");
  });

  it("maps unexpected exceptions to a generic 500 without leaking details", async () => {
    const { deps } = makeDeps({
      convert: vi.fn(async () => {
        throw new Error(`boom ${API_KEY}`);
      }),
    });
    const response = await handleConvertRequest(makeRequest({ audio: webmBlob(), voiceSlug: "warm-narrator" }), deps);
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain(API_KEY);
    expect(text).not.toContain("boom");
  });

  it("never includes the API key in any response", async () => {
    const { deps } = makeDeps();
    const responses = await Promise.all([
      handleConvertRequest(makeRequest({ audio: webmBlob(), voiceSlug: "warm-narrator" }), deps),
      handleConvertRequest(makeRequest({ audio: webmBlob(), voiceSlug: "nope" }), deps),
      handleConvertRequest(makeRequest({}), deps),
    ]);
    for (const response of responses) {
      const text = await response.text();
      expect(text).not.toContain(API_KEY);
      expect([...response.headers.values()].join(" ")).not.toContain(API_KEY);
    }
  });
});
