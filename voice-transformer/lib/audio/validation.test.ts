import { describe, expect, it } from "vitest";
import {
  getFileExtension,
  isSupportedAudio,
  normalizeMimeType,
  validateAudioDuration,
  validateAudioFile,
  type AudioLimits,
} from "./validation";

const limits: AudioLimits = { maxDurationSeconds: 30, maxSizeBytes: 15 * 1024 * 1024 };

describe("normalizeMimeType", () => {
  it("strips codec parameters and lower-cases", () => {
    expect(normalizeMimeType("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(normalizeMimeType("Audio/MPEG")).toBe("audio/mpeg");
    expect(normalizeMimeType(undefined)).toBe("");
  });
});

describe("getFileExtension", () => {
  it("returns the lower-cased extension or an empty string", () => {
    expect(getFileExtension("Take 1.MP3")).toBe("mp3");
    expect(getFileExtension("recording")).toBe("");
    expect(getFileExtension("trailing.")).toBe("");
  });
});

describe("isSupportedAudio", () => {
  it("accepts by extension when the MIME type is missing", () => {
    expect(isSupportedAudio({ name: "song.flac", type: "" })).toBe(true);
    expect(isSupportedAudio({ name: "voice.oga", type: "" })).toBe(true);
  });

  it("accepts by MIME type when the name is unhelpful", () => {
    expect(isSupportedAudio({ name: "blob", type: "audio/webm;codecs=opus" })).toBe(true);
    expect(isSupportedAudio({ name: "blob", type: "audio/mp4" })).toBe(true);
  });

  it("rejects non-audio files", () => {
    expect(isSupportedAudio({ name: "notes.txt", type: "text/plain" })).toBe(false);
    expect(isSupportedAudio({ name: "clip.mov", type: "video/quicktime" })).toBe(false);
  });
});

describe("validateAudioFile", () => {
  it("accepts a normal MP3", () => {
    expect(validateAudioFile({ name: "take.mp3", type: "audio/mpeg", size: 200_000 }, limits)).toEqual({ ok: true });
  });

  it("rejects empty files", () => {
    const result = validateAudioFile({ name: "take.mp3", type: "audio/mpeg", size: 0 }, limits);
    expect(result).toMatchObject({ ok: false, code: "empty-file" });
  });

  it("rejects oversized files with a readable message", () => {
    const result = validateAudioFile({ name: "big.wav", type: "audio/wav", size: 16 * 1024 * 1024 }, limits);
    expect(result).toMatchObject({ ok: false, code: "file-too-large" });
    if (!result.ok) expect(result.message).toContain("16.0 MB");
  });

  it("rejects unsupported formats", () => {
    const result = validateAudioFile({ name: "doc.pdf", type: "application/pdf", size: 1000 }, limits);
    expect(result).toMatchObject({ ok: false, code: "unsupported-format" });
    if (!result.ok) expect(result.message).toContain("not supported");
  });
});

describe("validateAudioDuration", () => {
  it("accepts a 5 second clip", () => {
    expect(validateAudioDuration(5, limits)).toEqual({ ok: true });
  });

  it("accepts exactly 30 seconds", () => {
    expect(validateAudioDuration(30, limits)).toEqual({ ok: true });
  });

  it("rejects anything over the limit with the duration in the message", () => {
    const result = validateAudioDuration(42, limits);
    expect(result).toMatchObject({ ok: false, code: "audio-too-long" });
    if (!result.ok) {
      expect(result.message).toBe("This recording is 42 seconds long. The MVP currently supports up to 30 seconds.");
    }
  });

  it("rejects 30.1 seconds without tolerance but accepts it within the server tolerance", () => {
    expect(validateAudioDuration(30.1, limits)).toMatchObject({ ok: false });
    expect(validateAudioDuration(30.1, limits, { toleranceSeconds: 0.5 })).toEqual({ ok: true });
    expect(validateAudioDuration(31, limits, { toleranceSeconds: 0.5 })).toMatchObject({ ok: false });
  });

  it("rejects unknown or zero durations", () => {
    expect(validateAudioDuration(Number.NaN, limits)).toMatchObject({ ok: false });
    expect(validateAudioDuration(Number.POSITIVE_INFINITY, limits)).toMatchObject({ ok: false });
    expect(validateAudioDuration(0, limits)).toMatchObject({ ok: false });
  });
});
