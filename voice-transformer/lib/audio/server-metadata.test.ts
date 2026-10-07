import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { probeAudio } from "./server-metadata";

const fixture = (name: string) => new Uint8Array(readFileSync(join(process.cwd(), "tests", "fixtures", name)));

describe("probeAudio", () => {
  it.each([
    ["tone-2s.wav", "WAVE"],
    ["tone-2s.mp3", "MPEG"],
    ["tone-2s.flac", "FLAC"],
    ["tone-2s.ogg", "Ogg"],
    ["tone-2s.m4a", "M4A"],
  ])("reads the duration of %s", async (name, containerHint) => {
    const result = await probeAudio(fixture(name));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.durationSeconds).toBeGreaterThan(1.9);
      expect(result.durationSeconds).toBeLessThan(2.2);
      expect(result.container).toContain(containerHint);
    }
  });

  it("falls back to the block scanner for MediaRecorder-style WebM", async () => {
    const short = await probeAudio(fixture("tone-2s-live.webm"), "audio/webm");
    expect(short).toMatchObject({ ok: true, container: "EBML/webm" });
    if (short.ok) expect(short.durationSeconds).toBeCloseTo(2, 1);

    const long = await probeAudio(fixture("tone-31s-live.webm"), "audio/webm");
    expect(long.ok).toBe(true);
    if (long.ok) expect(long.durationSeconds).toBeGreaterThan(30.5);
  });

  it("reads an over-limit duration from ordinary MP3 metadata", async () => {
    const result = await probeAudio(fixture("tone-31s.mp3"), "audio/mpeg");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.durationSeconds).toBeGreaterThan(30.5);
  });

  it("rejects bytes that are not audio", async () => {
    const result = await probeAudio(new Uint8Array(4096).fill(0x41));
    expect(result).toEqual({ ok: false, reason: "unparseable" });
  });

  it("rejects an empty buffer", async () => {
    const result = await probeAudio(new Uint8Array(0));
    expect(result.ok).toBe(false);
  });
});
