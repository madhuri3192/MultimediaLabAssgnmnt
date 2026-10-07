import { PRODUCT_NAME } from "./site-header";

const SOURCE_URL = "https://github.com/ARPANPATRA111/mm-lab/tree/main/voice-transformer";

const linkClass = "underline decoration-border-strong underline-offset-2 hover:text-foreground";

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          {PRODUCT_NAME} — a non-commercial technical prototype. Prototype powered by{" "}
          <a href="https://elevenlabs.io" className={linkClass} rel="noreferrer" target="_blank">
            ElevenLabs
          </a>
          .
        </p>
        <p className="flex flex-wrap gap-x-3">
          <span>No accounts, no history, no stored audio.</span>
          <a href={SOURCE_URL} className={linkClass} rel="noreferrer" target="_blank">
            Source on GitHub
          </a>
        </p>
      </div>
    </footer>
  );
}
