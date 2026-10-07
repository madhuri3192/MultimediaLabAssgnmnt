import { InfoSection } from "@/components/layout/info-section";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { SetupNotice } from "@/components/voice-transformer/setup-notice";
import { VoiceTransformer } from "@/components/voice-transformer/voice-transformer";
import { readServerConfig } from "@/lib/server/config";
import { listConfiguredVoices } from "@/lib/voices/config";

// Read configuration per request so new env vars never serve a stale voice list.
export const dynamic = "force-dynamic";

export default function HomePage() {
  const config = readServerConfig();
  const voices = listConfiguredVoices();
  const ready = config.apiKey !== null && voices.length > 0;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-8 space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Transform your voice. Keep your performance.</h1>
          <p className="max-w-2xl text-base text-muted">
            Record or upload up to {config.limits.maxDurationSeconds} seconds of speech and hear the same performance in a
            different AI voice.
          </p>
        </div>

        <div className="space-y-8">
          {ready ? (
            <VoiceTransformer voices={voices} limits={config.limits} />
          ) : (
            <SetupNotice providerConfigured={config.apiKey !== null} voicesConfigured={voices.length > 0} />
          )}
          <InfoSection maxDurationSeconds={config.limits.maxDurationSeconds} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
