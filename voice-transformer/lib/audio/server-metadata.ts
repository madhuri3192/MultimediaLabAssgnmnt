import { parseBuffer } from "music-metadata";
import { scanWebmDuration } from "./webm-duration";

export type AudioProbe =
  | { ok: true; durationSeconds: number; container: string; codec: string | null }
  | { ok: false; reason: "unparseable" | "unknown-container" | "no-duration" };

const ACCEPTED_CONTAINER_HINTS = ["mpeg", "wave", "flac", "ogg", "m4a", "mp4", "isom", "ebml"];

export type ProbeAudio = (bytes: Uint8Array<ArrayBuffer>, mimeType?: string) => Promise<AudioProbe>;

export const probeAudio: ProbeAudio = async (bytes, mimeType) => {
  let container: string | undefined;
  let codec: string | undefined;
  let duration: number | undefined;

  try {
    const metadata = await parseBuffer(
      bytes,
      mimeType ? { mimeType } : undefined,
      { duration: true, skipCovers: true, skipPostHeaders: true },
    );
    container = metadata.format.container;
    codec = metadata.format.codec;
    duration = metadata.format.duration;
  } catch {
    return { ok: false, reason: "unparseable" };
  }

  if (!container) return { ok: false, reason: "unparseable" };

  const lowered = container.toLowerCase();
  if (!ACCEPTED_CONTAINER_HINTS.some((hint) => lowered.includes(hint))) {
    return { ok: false, reason: "unknown-container" };
  }

  if ((duration === undefined || !Number.isFinite(duration)) && lowered.startsWith("ebml")) {
    duration = scanWebmDuration(bytes) ?? undefined;
  }

  if (duration === undefined || !Number.isFinite(duration) || duration <= 0) {
    return { ok: false, reason: "no-duration" };
  }

  return { ok: true, durationSeconds: duration, container, codec: codec ?? null };
};
