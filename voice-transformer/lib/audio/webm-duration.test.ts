import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanWebmDuration } from "./webm-duration";

const fixture = (name: string) => new Uint8Array(readFileSync(join(process.cwd(), "tests", "fixtures", name)));

/** Builds an EBML element: id bytes + 1-byte size + payload. */
function element(id: number[], payload: number[]): number[] {
  return [...id, 0x80 | payload.length, ...payload];
}

/** Master element with the "unknown size" marker, as MediaRecorder writes. */
function unknownSizeMaster(id: number[], children: number[]): number[] {
  return [...id, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, ...children];
}

function simpleBlock(relativeTimecode: number): number[] {
  const rel = relativeTimecode & 0xffff;
  return element([0xa3], [0x81, rel >> 8, rel & 0xff, 0x80, 0x00, 0x00]);
}

describe("scanWebmDuration", () => {
  it("reads the duration from a live WebM without an Info.Duration element", () => {
    expect(scanWebmDuration(fixture("tone-2s-live.webm"))).toBeCloseTo(2, 1);
    expect(scanWebmDuration(fixture("tone-31s-live.webm"))).toBeCloseTo(31, 1);
  });

  it("prefers Info.Duration when present", () => {
    // Info { TimecodeScale = 1_000_000 ns, Duration = 2500 (float32, big-endian) } inside an unknown-size Segment.
    const durationBytes = Array.from(new Uint8Array(new Float32Array([2500]).buffer).reverse());
    const info = element(
      [0x15, 0x49, 0xa9, 0x66],
      [...element([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40]), ...element([0x44, 0x89], durationBytes)],
    );
    const bytes = new Uint8Array(unknownSizeMaster([0x18, 0x53, 0x80, 0x67], info));
    expect(scanWebmDuration(bytes)).toBeCloseTo(2.5, 3);
  });

  it("uses the last block timestamp across unknown-size clusters", () => {
    const cluster = (timecode: number, blocks: number[][]) =>
      unknownSizeMaster([0x1f, 0x43, 0xb6, 0x75], [...element([0xe7], [timecode >> 8, timecode & 0xff]), ...blocks.flat()]);
    const segment = unknownSizeMaster(
      [0x18, 0x53, 0x80, 0x67],
      [...cluster(0, [simpleBlock(0), simpleBlock(20)]), ...cluster(1000, [simpleBlock(0), simpleBlock(500)])],
    );
    expect(scanWebmDuration(new Uint8Array(segment))).toBeCloseTo(1.5, 3);
  });

  it("returns null for data without any timestamps", () => {
    expect(scanWebmDuration(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x80]))).toBeNull();
    expect(scanWebmDuration(new Uint8Array(0))).toBeNull();
    expect(scanWebmDuration(new Uint8Array(64).fill(0))).toBeNull();
  });
});
