"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SparklesIcon } from "@/components/ui/icons";
import type { RecordingResult } from "@/hooks/use-recorder";
import { requestConversion, toUserFacingError } from "@/lib/api/client";
import { buildDownloadFileName } from "@/lib/audio/format";
import { extensionForMimeType } from "@/lib/audio/media-recorder";
import type { AudioLimits } from "@/lib/audio/validation";
import type { PublicVoice, VoiceSlug } from "@/lib/voices/config";
import type { ProcessingStep, ResultAudio, SourceAudio, UserFacingError } from "@/types/audio";
import { ErrorBanner } from "./error-banner";
import { ProcessingState } from "./processing-state";
import { Recorder } from "./recorder";
import { ResultPlayer } from "./result-player";
import { panelId, SourceModeTabs, tabId, type SourceMode } from "./source-mode-tabs";
import { SourcePreview } from "./source-preview";
import { UploadZone, type AcceptedUpload } from "./upload-zone";
import { VoiceSelector } from "./voice-selector";

export type TransformerState =
  | { phase: "idle" }
  | { phase: "recording" }
  | { phase: "source-ready"; source: SourceAudio }
  | { phase: "processing"; source: SourceAudio; step: ProcessingStep; startedAt: number }
  | { phase: "result-ready"; source: SourceAudio; result: ResultAudio }
  | { phase: "error"; source: SourceAudio | null; error: UserFacingError };

type Action =
  | { type: "recording-started" }
  | { type: "recording-cancelled" }
  | { type: "source-ready"; source: SourceAudio }
  | { type: "discard-source" }
  | { type: "processing-started"; startedAt: number }
  | { type: "processing-step"; step: ProcessingStep }
  | { type: "processing-cancelled" }
  | { type: "result-ready"; result: ResultAudio }
  | { type: "failed"; error: UserFacingError }
  | { type: "retry" }
  | { type: "reset" };

export function transformerReducer(state: TransformerState, action: Action): TransformerState {
  switch (action.type) {
    case "recording-started":
      return { phase: "recording" };
    case "recording-cancelled":
      return state.phase === "recording" ? { phase: "idle" } : state;
    case "source-ready":
      return { phase: "source-ready", source: action.source };
    case "discard-source":
    case "reset":
      return { phase: "idle" };
    case "processing-started": {
      const source = "source" in state ? state.source : null;
      if (!source || state.phase === "processing") return state;
      return { phase: "processing", source, step: "preparing", startedAt: action.startedAt };
    }
    case "processing-step":
      return state.phase === "processing" ? { ...state, step: action.step } : state;
    case "processing-cancelled":
      return state.phase === "processing" ? { phase: "source-ready", source: state.source } : state;
    case "result-ready":
      return state.phase === "processing" ? { phase: "result-ready", source: state.source, result: action.result } : state;
    case "failed":
      return { phase: "error", source: "source" in state ? state.source : null, error: action.error };
    case "retry":
      return state.phase === "error" && state.source ? { phase: "source-ready", source: state.source } : { phase: "idle" };
    default:
      return state;
  }
}

type VoiceTransformerProps = {
  voices: PublicVoice[];
  limits: AudioLimits;
};

export function VoiceTransformer({ voices, limits }: VoiceTransformerProps) {
  const [state, dispatch] = useReducer(transformerReducer, { phase: "idle" });
  const [mode, setMode] = useState<SourceMode>("record");
  const [voiceSlug, setVoiceSlug] = useState<VoiceSlug>(voices[0].slug);
  const [consentGiven, setConsentGiven] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Object URLs are created in handlers and revoked when the state that used
  // them is dropped; creating them in effects would break under StrictMode.
  const objectUrls = useRef(new Set<string>());
  const createUrl = useCallback((blob: Blob) => {
    const url = URL.createObjectURL(blob);
    objectUrls.current.add(url);
    return url;
  }, []);
  const releaseUrl = useCallback((url: string | undefined) => {
    if (!url) return;
    URL.revokeObjectURL(url);
    objectUrls.current.delete(url);
  }, []);
  useEffect(() => {
    const urls = objectUrls.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
      abortRef.current?.abort();
    };
  }, []);

  const currentSource = "source" in state ? state.source : null;
  const currentResult = state.phase === "result-ready" ? state.result : null;
  const selectedVoice = voices.find((voice) => voice.slug === voiceSlug) ?? voices[0];
  const busy = state.phase === "recording" || state.phase === "processing";

  const releaseCurrent = useCallback(() => {
    releaseUrl(currentSource?.url);
    releaseUrl(currentResult?.url);
  }, [currentResult?.url, currentSource?.url, releaseUrl]);

  const acceptSource = useCallback(
    (source: Omit<SourceAudio, "url">) => {
      releaseCurrent();
      setConsentGiven(false);
      dispatch({ type: "source-ready", source: { ...source, url: createUrl(source.blob) } });
    },
    [createUrl, releaseCurrent],
  );

  const onRecordingStart = useCallback(() => dispatch({ type: "recording-started" }), []);
  const onRecordingCancel = useCallback(() => dispatch({ type: "recording-cancelled" }), []);

  const onRecordingComplete = useCallback(
    (recording: RecordingResult) => {
      acceptSource({
        blob: recording.blob,
        durationSeconds: recording.durationSeconds,
        mimeType: recording.mimeType,
        fileName: `recording.${extensionForMimeType(recording.mimeType)}`,
        origin: "recording",
      });
    },
    [acceptSource],
  );

  const onFileAccepted = useCallback(
    (upload: AcceptedUpload) => {
      acceptSource({
        blob: upload.file,
        durationSeconds: upload.durationSeconds,
        mimeType: upload.file.type,
        fileName: upload.file.name,
        origin: "upload",
      });
    },
    [acceptSource],
  );

  const onInputError = useCallback((error: UserFacingError) => dispatch({ type: "failed", error }), []);

  const discardSource = () => {
    releaseCurrent();
    setConsentGiven(false);
    dispatch({ type: "discard-source" });
  };

  const reset = () => {
    releaseCurrent();
    setConsentGiven(false);
    dispatch({ type: "reset" });
  };

  const cancelProcessing = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: "processing-cancelled" });
  };

  const transform = async () => {
    if (!currentSource || state.phase === "processing") return;
    const source = currentSource;
    const controller = new AbortController();
    abortRef.current = controller;
    const startedAt = performance.now();
    dispatch({ type: "processing-started", startedAt });

    try {
      const response = await requestConversion({
        audio: source.blob,
        fileName: source.fileName,
        voiceSlug,
        signal: controller.signal,
        onStep: (step) => dispatch({ type: "processing-step", step }),
      });
      const roundTripMs = Math.round(performance.now() - startedAt);
      if (process.env.NODE_ENV !== "production") {
        console.info("[voice-transformer] conversion timing", {
          sourceSeconds: source.durationSeconds,
          sourceBytes: source.blob.size,
          outputBytes: response.blob.size,
          roundTripMs,
          serverProcessingMs: response.processingMs,
          providerMs: response.providerMs,
        });
      }
      dispatch({
        type: "result-ready",
        result: {
          blob: response.blob,
          url: createUrl(response.blob),
          downloadName: buildDownloadFileName(),
          processingMs: response.processingMs,
          providerMs: response.providerMs,
          roundTripMs,
        },
      });
    } catch (error) {
      if (controller.signal.aborted) return; // user cancelled; state already updated
      dispatch({ type: "failed", error: toUserFacingError(error) });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const needsConsent = currentSource?.origin === "upload";
  const canTransform = Boolean(currentSource) && (!needsConsent || consentGiven);

  const statusMessage = (() => {
    switch (state.phase) {
      case "recording":
        return `Recording started. It stops automatically at ${limits.maxDurationSeconds} seconds.`;
      case "source-ready":
        return state.source.origin === "recording" ? "Recording ready to transform." : "File ready to transform.";
      case "processing":
        return "Transforming your performance.";
      default:
        return "";
    }
  })();

  return (
    <section aria-labelledby="transformer-heading" className="rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-8">
      <h2 id="transformer-heading" className="sr-only">
        Voice transformer
      </h2>
      <p className="sr-only" role="status" aria-live="polite">
        {statusMessage}
      </p>

      <div className="space-y-8">
        <VoiceSelector voices={voices} value={voiceSlug} onChange={setVoiceSlug} disabled={state.phase === "processing"} />

        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold">Source audio</p>
            <SourceModeTabs value={mode} onChange={setMode} disabled={busy || Boolean(currentSource)} />
          </div>

          <div role="tabpanel" id={panelId(mode)} aria-labelledby={tabId(mode)} className="space-y-4">
            {state.phase === "error" ? (
              <ErrorBanner
                error={state.error}
                actions={
                  state.source ? (
                    <>
                      <Button variant="secondary" onClick={() => void transform()}>
                        Try again
                      </Button>
                      <Button variant="ghost" onClick={reset}>
                        Start over
                      </Button>
                    </>
                  ) : (
                    <Button variant="ghost" onClick={() => dispatch({ type: "retry" })}>
                      Dismiss
                    </Button>
                  )
                }
              />
            ) : null}

            {state.phase === "result-ready" ? (
              <ResultPlayer result={state.result} source={state.source} voiceName={selectedVoice.name} onReset={reset} />
            ) : null}

            {state.phase === "processing" ? (
              <>
                <SourcePreview source={state.source} onDiscard={discardSource} disabled compact />
                <ProcessingState
                  step={state.step}
                  startedAt={state.startedAt}
                  voiceName={selectedVoice.name}
                  onCancel={cancelProcessing}
                />
              </>
            ) : null}

            {(state.phase === "source-ready" || (state.phase === "error" && state.source)) && currentSource ? (
              <>
                <SourcePreview source={currentSource} onDiscard={discardSource} />
                {needsConsent ? (
                  <label className="flex items-start gap-3 rounded-xl border border-border bg-surface-muted/60 p-4 text-sm">
                    <input
                      type="checkbox"
                      checked={consentGiven}
                      onChange={(event) => setConsentGiven(event.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                    />
                    <span>I confirm I have permission to use this recording.</span>
                  </label>
                ) : null}
                {state.phase === "source-ready" ? (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-muted">
                      Target: <span className="font-medium text-foreground">{selectedVoice.name}</span>
                    </p>
                    <Button
                      size="lg"
                      onClick={() => void transform()}
                      disabled={!canTransform}
                      leadingIcon={<SparklesIcon size={18} />}
                      className="sm:min-w-52"
                    >
                      Transform Voice
                    </Button>
                  </div>
                ) : null}
              </>
            ) : null}

            {(state.phase === "idle" || state.phase === "recording" || (state.phase === "error" && !state.source)) &&
            mode === "record" ? (
              <Recorder
                maxDurationSeconds={limits.maxDurationSeconds}
                onRecordingStart={onRecordingStart}
                onRecordingComplete={onRecordingComplete}
                onRecordingCancel={onRecordingCancel}
                onError={onInputError}
              />
            ) : null}

            {(state.phase === "idle" || (state.phase === "error" && !state.source)) && mode === "upload" ? (
              <UploadZone limits={limits} onFileAccepted={onFileAccepted} onError={onInputError} />
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
