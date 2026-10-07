"use client";

import type { PublicVoice, VoiceSlug } from "@/lib/voices/config";
import { cn } from "@/lib/utils/cn";
import { CheckIcon } from "@/components/ui/icons";

type VoiceSelectorProps = {
  voices: PublicVoice[];
  value: VoiceSlug;
  onChange: (slug: VoiceSlug) => void;
  disabled?: boolean;
};

export function VoiceSelector({ voices, value, onChange, disabled }: VoiceSelectorProps) {
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-3 flex w-full items-baseline justify-between gap-3">
        <span className="text-sm font-semibold">Target voice</span>
        <span className="text-xs text-muted">Custom voices — coming later</span>
      </legend>
      <div className="grid gap-3 sm:grid-cols-3" role="presentation">
        {voices.map((voice) => {
          const selected = voice.slug === value;
          return (
            <label
              key={voice.slug}
              className={cn(
                "relative flex cursor-pointer flex-col gap-1 rounded-xl border p-4 transition-colors",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-surface",
                selected ? "border-accent bg-accent-soft" : "border-border bg-surface hover:border-border-strong",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <input
                type="radio"
                name="target-voice"
                value={voice.slug}
                checked={selected}
                onChange={() => onChange(voice.slug)}
                className="sr-only"
              />
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{voice.name}</span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full border transition-colors",
                    selected ? "border-accent bg-accent text-accent-foreground" : "border-border-strong",
                  )}
                >
                  {selected ? <CheckIcon size={12} strokeWidth={3} /> : null}
                </span>
              </span>
              <span className="text-sm text-muted">{voice.description}</span>
            </label>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted">Synthetic voices designed for this prototype. They are not modelled on real people.</p>
    </fieldset>
  );
}
