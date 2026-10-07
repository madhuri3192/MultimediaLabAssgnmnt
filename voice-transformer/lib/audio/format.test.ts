import { describe, expect, it } from "vitest";
import { buildDownloadFileName, formatBytes, formatClock, formatDurationHuman } from "./format";

describe("formatClock", () => {
  it("formats mm:ss and floors fractions", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(7.9)).toBe("00:07");
    expect(formatClock(65)).toBe("01:05");
  });
});

describe("formatDurationHuman", () => {
  it("uses whole seconds when possible and one decimal otherwise", () => {
    expect(formatDurationHuman(1)).toBe("1 second");
    expect(formatDurationHuman(12)).toBe("12 seconds");
    expect(formatDurationHuman(12.34)).toBe("12.3 seconds");
    expect(formatDurationHuman(75)).toBe("1 min 15 sec");
  });
});

describe("formatBytes", () => {
  it("scales units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(15 * 1024 * 1024)).toBe("15.0 MB");
  });
});

describe("buildDownloadFileName", () => {
  it("embeds a local timestamp", () => {
    expect(buildDownloadFileName(new Date(2026, 8, 16, 21, 58))).toBe("voice-conversion-2026-09-16-2158.mp3");
  });
});
