import { InfoIcon } from "@/components/ui/icons";
import { VOICE_DEFINITIONS } from "@/lib/voices/config";

type SetupNoticeProps = {
  providerConfigured: boolean;
  voicesConfigured: boolean;
};

export function SetupNotice({ providerConfigured, voicesConfigured }: SetupNoticeProps) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm sm:p-8">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-accent">
          <InfoIcon size={22} />
        </span>
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Almost there — finish the ElevenLabs setup</h2>
            <p className="mt-1 text-sm text-muted">
              The app runs, but the server is missing configuration. Add the values below to{" "}
              <code className="rounded bg-surface-muted px-1 py-0.5 font-mono text-xs">.env.local</code> and restart
              the dev server.
            </p>
          </div>
          <ul className="space-y-2 text-sm">
            <li className="flex items-start gap-2">
              <StatusDot ok={providerConfigured} />
              <span>
                <code className="font-mono text-xs">ELEVENLABS_API_KEY</code> — a dedicated ElevenLabs API key
                {providerConfigured ? " (configured)" : " (missing)"}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <StatusDot ok={voicesConfigured} />
              <span>
                At least one target voice ID{voicesConfigured ? " (configured)" : " (none configured)"}:
                <ul className="mt-1 space-y-1 pl-4">
                  {VOICE_DEFINITIONS.map((voice) => (
                    <li key={voice.slug}>
                      <code className="font-mono text-xs">{voice.environmentVariable}</code>{" "}
                      <span className="text-muted">— {voice.name}</span>
                    </li>
                  ))}
                </ul>
              </span>
            </li>
          </ul>
          <p className="text-sm text-muted">
            Create the voices with ElevenLabs Voice Design (free plan), copy their voice IDs, and see the README for the
            full step-by-step guide.
          </p>
        </div>
      </div>
    </div>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${ok ? "bg-success" : "bg-danger"}`}
    />
  );
}
