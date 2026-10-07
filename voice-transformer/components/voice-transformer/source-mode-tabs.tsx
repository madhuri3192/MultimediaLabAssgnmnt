"use client";

import { useRef, type KeyboardEvent } from "react";
import { MicIcon, UploadIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils/cn";

export type SourceMode = "record" | "upload";

const TABS: Array<{ id: SourceMode; label: string; Icon: typeof MicIcon }> = [
  { id: "record", label: "Record", Icon: MicIcon },
  { id: "upload", label: "Upload", Icon: UploadIcon },
];

type SourceModeTabsProps = {
  value: SourceMode;
  onChange: (mode: SourceMode) => void;
  disabled?: boolean;
};

export function tabId(mode: SourceMode) {
  return `source-tab-${mode}`;
}

export function panelId(mode: SourceMode) {
  return `source-panel-${mode}`;
}

export function SourceModeTabs({ value, onChange, disabled }: SourceModeTabsProps) {
  const refs = useRef<Record<SourceMode, HTMLButtonElement | null>>({ record: null, upload: null });

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = TABS.findIndex((tab) => tab.id === value);
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % TABS.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + TABS.length) % TABS.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = TABS.length - 1;
    if (next === null) return;
    event.preventDefault();
    const target = TABS[next].id;
    onChange(target);
    refs.current[target]?.focus();
  };

  return (
    <div role="tablist" aria-label="Audio source" className="inline-flex rounded-xl border border-border bg-surface-muted p-1">
      {TABS.map(({ id, label, Icon }) => {
        const selected = id === value;
        return (
          <button
            key={id}
            ref={(node) => {
              refs.current[id] = node;
            }}
            type="button"
            role="tab"
            id={tabId(id)}
            aria-selected={selected}
            aria-controls={panelId(id)}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(id)}
            onKeyDown={onKeyDown}
            className={cn(
              "inline-flex h-10 min-w-28 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-muted",
              "disabled:cursor-not-allowed disabled:opacity-60",
              selected ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground",
            )}
          >
            <Icon size={16} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
