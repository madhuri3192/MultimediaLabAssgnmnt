// Chrome's MediaRecorder writes WebM with an unknown-size Segment and no
// Info.Duration element, so general metadata parsers report no duration. This
// walks just enough EBML to read the last block timestamp instead, and returns
// null on anything unexpected.

const ID = {
  SEGMENT: 0x18538067,
  INFO: 0x1549a966,
  TIMECODE_SCALE: 0x2ad7b1,
  DURATION: 0x4489,
  CLUSTER: 0x1f43b675,
  TIMECODE: 0xe7,
  SIMPLE_BLOCK: 0xa3,
  BLOCK_GROUP: 0xa0,
  BLOCK: 0xa1,
  BLOCK_DURATION: 0x9b,
} as const;

const DESCEND_INTO = new Set<number>([ID.SEGMENT, ID.INFO, ID.CLUSTER, ID.BLOCK_GROUP]);

const DEFAULT_TIMECODE_SCALE_NS = 1_000_000;
const NANOS_PER_SECOND = 1_000_000_000;

type Vint = { value: number; length: number; unknown: boolean };

function readVint(buf: Uint8Array, pos: number, keepMarker: boolean): Vint | null {
  if (pos >= buf.length) return null;
  const first = buf[pos];
  if (first === 0) return null;
  let length = 1;
  let mask = 0x80;
  while ((first & mask) === 0) {
    mask >>= 1;
    length += 1;
  }
  if (length > 8 || pos + length > buf.length) return null;

  let value = keepMarker ? first : first & (mask - 1);
  let allOnes = (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < length; i += 1) {
    const byte = buf[pos + i];
    value = value * 256 + byte;
    if (byte !== 0xff) allOnes = false;
  }
  return { value, length, unknown: !keepMarker && allOnes };
}

function readUint(buf: Uint8Array, pos: number, length: number): number {
  let value = 0;
  for (let i = 0; i < length; i += 1) value = value * 256 + buf[pos + i];
  return value;
}

function readFloat(buf: Uint8Array, pos: number, length: number): number | null {
  const view = new DataView(buf.buffer, buf.byteOffset + pos, length);
  if (length === 4) return view.getFloat32(0);
  if (length === 8) return view.getFloat64(0);
  return null;
}

function readInt16(buf: Uint8Array, pos: number): number {
  return new DataView(buf.buffer, buf.byteOffset + pos, 2).getInt16(0);
}

export function scanWebmDuration(buf: Uint8Array): number | null {
  let pos = 0;
  let timecodeScale = DEFAULT_TIMECODE_SCALE_NS;
  let clusterTimecode = 0;
  let infoDuration: number | null = null;
  let lastBlockTimecode: number | null = null;
  let lastBlockDuration = 0;

  while (pos < buf.length) {
    const id = readVint(buf, pos, true);
    if (!id) break;
    pos += id.length;

    const size = readVint(buf, pos, false);
    if (!size) break;
    pos += size.length;

    const dataStart = pos;
    const dataEnd = size.unknown ? buf.length : Math.min(buf.length, dataStart + size.value);
    const dataLength = dataEnd - dataStart;

    if (DESCEND_INTO.has(id.value)) continue;

    switch (id.value) {
      case ID.TIMECODE_SCALE:
        if (dataLength > 0 && dataLength <= 8) timecodeScale = readUint(buf, dataStart, dataLength);
        break;
      case ID.DURATION:
        infoDuration = readFloat(buf, dataStart, dataLength);
        break;
      case ID.TIMECODE:
        if (dataLength > 0 && dataLength <= 8) clusterTimecode = readUint(buf, dataStart, dataLength);
        break;
      case ID.SIMPLE_BLOCK:
      case ID.BLOCK: {
        const track = readVint(buf, dataStart, false);
        if (track && dataStart + track.length + 2 <= dataEnd) {
          lastBlockTimecode = clusterTimecode + readInt16(buf, dataStart + track.length);
          lastBlockDuration = 0;
        }
        break;
      }
      case ID.BLOCK_DURATION:
        if (dataLength > 0 && dataLength <= 8) lastBlockDuration = readUint(buf, dataStart, dataLength);
        break;
      default:
        break;
    }

    // An unknown-size element we don't descend into cannot be skipped safely.
    if (size.unknown) break;
    pos = dataEnd;
  }

  if (infoDuration !== null && Number.isFinite(infoDuration) && infoDuration > 0) {
    return (infoDuration * timecodeScale) / NANOS_PER_SECOND;
  }
  if (lastBlockTimecode === null) return null;
  return ((lastBlockTimecode + lastBlockDuration) * timecodeScale) / NANOS_PER_SECOND;
}
