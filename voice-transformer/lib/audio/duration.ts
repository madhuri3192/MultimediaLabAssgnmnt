// Chrome reports Infinity for WebM blobs without a duration header (including
// its own MediaRecorder output). Seeking far past the end makes it scan the
// file and emit durationchange with the real value.
export function getAudioDuration(blob: Blob, timeoutMs = 10_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.muted = true;
    const url = URL.createObjectURL(blob);
    let settled = false;
    let nudged = false;

    const finish = (outcome: { duration: number } | { error: Error }) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      audio.removeEventListener("loadedmetadata", onMetadata);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("error", onError);
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
      if ("error" in outcome) reject(outcome.error);
      else resolve(outcome.duration);
    };

    const settleIfFinite = () => {
      const { duration } = audio;
      if (Number.isFinite(duration) && duration > 0) {
        finish({ duration });
        return true;
      }
      return false;
    };

    const onMetadata = () => {
      if (settleIfFinite()) return;
      if (!nudged) {
        nudged = true;
        audio.currentTime = Number.MAX_SAFE_INTEGER;
      }
    };
    const onDurationChange = () => {
      settleIfFinite();
    };
    const onError = () => finish({ error: new Error("The browser could not decode this audio file.") });

    const timer = window.setTimeout(
      () => finish({ error: new Error("Timed out while reading the audio duration.") }),
      timeoutMs,
    );

    audio.addEventListener("loadedmetadata", onMetadata);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("error", onError);
    audio.src = url;
  });
}
