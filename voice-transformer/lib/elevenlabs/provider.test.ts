import { describe, expect, it, vi } from "vitest";
import { ElevenLabsVoiceConversionProvider } from "./provider";
import { ProviderError } from "./types";

const audio = new Uint8Array([1, 2, 3, 4]);

function makeProvider(fetchImpl: ReturnType<typeof vi.fn>) {
  return new ElevenLabsVoiceConversionProvider({
    apiKey: "sk-test-key",
    modelId: "eleven_multilingual_sts_v2",
    outputFormat: "mp3_44100_128",
    removeBackgroundNoise: false,
    timeoutMs: 5000,
    fetchImpl: fetchImpl as unknown as (input: string, init: RequestInit) => Promise<Response>,
  });
}

describe("ElevenLabsVoiceConversionProvider", () => {
  it("builds the documented speech-to-speech request", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(new Uint8Array([9, 9, 9]), { status: 200, headers: { "content-type": "audio/mpeg" } }),
    );
    const provider = makeProvider(fetchImpl);

    const result = await provider.convert({ audio, mimeType: "audio/webm", fileName: "recording.webm", voiceId: "voice_abc" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.elevenlabs.io/v1/speech-to-speech/voice_abc?output_format=mp3_44100_128");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("sk-test-key");

    const form = init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("model_id")).toBe("eleven_multilingual_sts_v2");
    expect(form.get("remove_background_noise")).toBeNull();
    const file = form.get("audio") as File;
    expect(file).toBeInstanceOf(Blob);
    expect(file.name).toBe("recording.webm");
    expect(file.type).toBe("audio/webm");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(audio);

    expect(result.mimeType).toBe("audio/mpeg");
    expect(Array.from(result.audio)).toEqual([9, 9, 9]);
    expect(result.providerLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it("URL-encodes the voice id and sends the noise-removal flag when enabled", async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1]), { headers: { "content-type": "audio/mpeg" } }));
    const provider = new ElevenLabsVoiceConversionProvider({
      apiKey: "k",
      modelId: "m",
      outputFormat: "mp3_44100_128",
      removeBackgroundNoise: true,
      timeoutMs: 1000,
      fetchImpl: fetchImpl as unknown as (input: string, init: RequestInit) => Promise<Response>,
    });
    await provider.convert({ audio, mimeType: "audio/mpeg", fileName: "a.mp3", voiceId: "we ird/id" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/v1/speech-to-speech/we%20ird%2Fid?");
    expect((init.body as FormData).get("remove_background_noise")).toBe("true");
  });

  it("maps HTTP failures to ProviderError", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ detail: { status: "quota_exceeded", message: "no credits" } }), { status: 401 }),
    );
    const provider = makeProvider(fetchImpl);
    await expect(provider.convert({ audio, mimeType: "audio/webm", fileName: "r.webm", voiceId: "v" })).rejects.toMatchObject({
      name: "ProviderError",
      code: "quota",
      providerStatus: 401,
    });
  });

  it("maps network failures and timeouts", async () => {
    const networkFailure = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(
      makeProvider(networkFailure).convert({ audio, mimeType: "audio/webm", fileName: "r.webm", voiceId: "v" }),
    ).rejects.toMatchObject({ code: "network" });

    const timeout = vi.fn(async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    await expect(
      makeProvider(timeout).convert({ audio, mimeType: "audio/webm", fileName: "r.webm", voiceId: "v" }),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("rejects empty or non-audio success responses", async () => {
    const empty = vi.fn(async () => new Response(new Uint8Array(0), { headers: { "content-type": "audio/mpeg" } }));
    await expect(
      makeProvider(empty).convert({ audio, mimeType: "audio/webm", fileName: "r.webm", voiceId: "v" }),
    ).rejects.toBeInstanceOf(ProviderError);

    const html = vi.fn(async () => new Response("<html/>", { headers: { "content-type": "text/html" } }));
    await expect(
      makeProvider(html).convert({ audio, mimeType: "audio/webm", fileName: "r.webm", voiceId: "v" }),
    ).rejects.toMatchObject({ code: "upstream" });
  });
});
