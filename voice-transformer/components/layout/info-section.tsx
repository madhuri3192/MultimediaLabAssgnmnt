type InfoSectionProps = {
  maxDurationSeconds: number;
};

export function InfoSection({ maxDurationSeconds }: InfoSectionProps) {
  return (
    <section aria-labelledby="info-heading" className="grid gap-4 sm:grid-cols-3">
      <h2 id="info-heading" className="sr-only">
        About this prototype
      </h2>
      <InfoCard title="How it works">
        Your recording is sent to our server and passed to ElevenLabs Speech-to-Speech. Words, timing, pauses and
        emotion stay the same — only the voice changes. Nothing is transcribed or rewritten.
      </InfoCard>
      <InfoCard title="Privacy">
        We don&apos;t save recordings in this application. Audio is sent to ElevenLabs for voice processing and is
        subject to their processing policies.
      </InfoCard>
      <InfoCard title="Best results">
        Speak clearly in a quiet room, 5–15 seconds at a time (up to {maxDurationSeconds}). English, Hindi and Hinglish
        work well with the multilingual model. Free-tier processing capacity is limited.
      </InfoCard>
    </section>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">{children}</p>
    </div>
  );
}
