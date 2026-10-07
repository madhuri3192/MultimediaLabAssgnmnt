"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckIcon, SpinnerIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils/cn";
import type { ProcessingStep } from "@/types/audio";

type ProcessingStateProps = {
  step: ProcessingStep;
  startedAt: number;
  voiceName: string;
  onCancel: () => void;
};

const STEPS: Array<{ id: ProcessingStep; label: string }> = [
  { id: "preparing", label: "Preparing audio" },
  { id: "transforming", label: "Transforming voice" },
  { id: "finalizing", label: "Finalizing result" },
];

export function ProcessingState({ step, startedAt, voiceName, onCancel }: ProcessingStateProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const tick = () => setElapsedSeconds(Math.max(0, (performance.now() - startedAt) / 1000));
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  const currentIndex = STEPS.findIndex((item) => item.id === step);

  return (
    <div className="rounded-xl border border-border bg-surface p-5" role="status" aria-live="polite" aria-busy="true">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-base font-semibold">Transforming your performance…</p>
          <p className="text-sm text-muted">Rendering with {voiceName}. Longer recordings take a little longer.</p>
        </div>
        <p className="tabular-nums text-sm text-muted">{elapsedSeconds.toFixed(1)}s</p>
      </div>

      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
        <div className="h-full w-1/3 rounded-full bg-accent motion-safe:animate-[indeterminate_1.4s_ease-in-out_infinite]" />
      </div>

      <ol className="mt-4 grid gap-2 sm:grid-cols-3">
        {STEPS.map((item, index) => {
          const done = index < currentIndex;
          const active = index === currentIndex;
          return (
            <li
              key={item.id}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
                active ? "bg-accent-soft font-medium text-foreground" : "text-muted",
              )}
              aria-current={active ? "step" : undefined}
            >
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                  done ? "border-success bg-success text-white" : active ? "border-accent text-accent" : "border-border-strong",
                )}
                aria-hidden="true"
              >
                {done ? <CheckIcon size={12} strokeWidth={3} /> : active ? <SpinnerIcon size={12} /> : null}
              </span>
              <span>
                {item.label}
                <span className="sr-only">{done ? " (done)" : active ? " (in progress)" : " (pending)"}</span>
              </span>
            </li>
          );
        })}
      </ol>

      <div className="mt-4 flex justify-end">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
