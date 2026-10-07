import { WaveIcon } from "@/components/ui/icons";

export const PRODUCT_NAME = "Retone";

export function SiteHeader() {
  return (
    <header className="border-b border-border bg-surface/80 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <WaveIcon size={20} />
          </span>
          <div className="leading-tight">
            <p className="text-base font-semibold">{PRODUCT_NAME}</p>
            <p className="text-xs text-muted">AI Speech-to-Speech Voice Transformer</p>
          </div>
        </div>
        <span className="rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted">Prototype</span>
      </div>
    </header>
  );
}
