"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  describeMicrophoneError,
  isRecordingSupported,
  pickRecordingMimeType,
  RECORDING_UNSUPPORTED_ERROR,
} from "@/lib/audio/media-recorder";
import type { UserFacingError } from "@/types/audio";

export type RecorderStatus = "idle" | "requesting" | "recording" | "stopping";

export type RecordingResult = {
  blob: Blob;
  durationSeconds: number;
  mimeType: string;
};

export type UseRecorderOptions = {
  maxDurationMs: number;
  onStart?: () => void;
  onComplete: (result: RecordingResult) => void;
  onError?: (error: UserFacingError) => void;
};

const TIMER_INTERVAL_MS = 100;

export function useRecorder({ maxDurationMs, onStart, onComplete, onError }: UseRecorderOptions) {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const callbacksRef = useRef({ onStart, onComplete, onError });
  useEffect(() => {
    callbacksRef.current = { onStart, onComplete, onError };
  }, [onStart, onComplete, onError]);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const unmountedRef = useRef(false);
  const busyRef = useRef(false);

  const releaseResources = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== "closed") {
      void context.close().catch(() => undefined);
    }
    recorderRef.current = null;
    busyRef.current = false;
    setAnalyser(null);
  }, []);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    setStatus("stopping");
    recorder.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    } else {
      releaseResources();
    }
    setStatus("idle");
    setElapsedMs(0);
  }, [releaseResources]);

  const attachAnalyser = useCallback((stream: MediaStream) => {
    try {
      const AudioContextCtor =
        window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return;
      const context = new AudioContextCtor();
      const source = context.createMediaStreamSource(stream);
      const node = context.createAnalyser();
      node.fftSize = 256;
      node.smoothingTimeConstant = 0.8;
      source.connect(node);
      audioContextRef.current = context;
      setAnalyser(node);
    } catch {
      // The level meter is optional; recording continues without it.
    }
  }, []);

  const start = useCallback(async () => {
    if (busyRef.current) return;
    if (!isRecordingSupported()) {
      callbacksRef.current.onError?.(RECORDING_UNSUPPORTED_ERROR);
      return;
    }
    busyRef.current = true;
    cancelledRef.current = false;
    setStatus("requesting");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      busyRef.current = false;
      setStatus("idle");
      callbacksRef.current.onError?.(describeMicrophoneError(error));
      return;
    }

    // The component may have unmounted while the permission prompt was open.
    if (unmountedRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      busyRef.current = false;
      return;
    }
    streamRef.current = stream;

    const preferredMimeType = pickRecordingMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = preferredMimeType ? new MediaRecorder(stream, { mimeType: preferredMimeType }) : new MediaRecorder(stream);
    } catch (error) {
      releaseResources();
      setStatus("idle");
      callbacksRef.current.onError?.(describeMicrophoneError(error));
      return;
    }

    recorderRef.current = recorder;
    chunksRef.current = [];
    attachAnalyser(stream);

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onerror = () => {
      releaseResources();
      setStatus("idle");
      setElapsedMs(0);
      callbacksRef.current.onError?.({
        code: "recording-failed",
        title: "Recording failed",
        message: "The browser stopped the recording unexpectedly. Please try again.",
      });
    };

    recorder.onstart = () => {
      startedAtRef.current = performance.now();
      setStatus("recording");
      setElapsedMs(0);
      callbacksRef.current.onStart?.();
      timerRef.current = window.setInterval(() => {
        const elapsed = performance.now() - startedAtRef.current;
        setElapsedMs(Math.min(elapsed, maxDurationMs));
        if (elapsed >= maxDurationMs) stop();
      }, TIMER_INTERVAL_MS);
    };

    recorder.onstop = () => {
      const elapsedMsAtStop = performance.now() - startedAtRef.current;
      const mimeType = recorder.mimeType || preferredMimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type: mimeType });
      chunksRef.current = [];
      const wasCancelled = cancelledRef.current;
      releaseResources();
      setStatus("idle");
      setElapsedMs(0);
      if (wasCancelled) return;
      if (blob.size === 0) {
        callbacksRef.current.onError?.({
          code: "recording-empty",
          title: "Nothing was recorded",
          message: "The recording came back empty. Check that your microphone is working and try again.",
        });
        return;
      }
      callbacksRef.current.onComplete({
        blob,
        durationSeconds: Math.min(elapsedMsAtStop, maxDurationMs) / 1000,
        mimeType,
      });
    };

    recorder.start();
  }, [attachAnalyser, maxDurationMs, releaseResources, stop]);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      cancelledRef.current = true;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // Already stopped.
        }
      }
      releaseResources();
    };
  }, [releaseResources]);

  return { status, elapsedMs, analyser, start, stop, cancel };
}
