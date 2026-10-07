#!/usr/bin/env node
// pnpm check:elevenlabs          key, plan, credits and configured voices (read-only)
// pnpm check:elevenlabs --probe  also runs one real 2-second conversion per voice
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const API = "https://api.elevenlabs.io";
const VOICES = [
  { slug: "warm-narrator", envVar: "ELEVENLABS_VOICE_WARM_ID" },
  { slug: "deep-studio", envVar: "ELEVENLABS_VOICE_DEEP_ID" },
  { slug: "bright-conversational", envVar: "ELEVENLABS_VOICE_BRIGHT_ID" },
];
const PROBE = process.argv.includes("--probe");

function loadEnv() {
  const env = { ...process.env };
  for (const file of [".env", ".env.local"]) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match || line.trim().startsWith("#")) continue;
      const value = match[2].replace(/\s+#.*$/, "").trim();
      env[match[1]] = value.replace(/^(["'])(.*)\1$/, "$2");
    }
  }
  return env;
}

const env = loadEnv();
const apiKey = env.ELEVENLABS_API_KEY?.trim();
const modelId = env.ELEVENLABS_MODEL_ID?.trim() || "eleven_multilingual_sts_v2";

const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => console.log(`  ✗ ${msg}`);
const info = (msg) => console.log(`  · ${msg}`);

async function request(path, init = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { "xi-api-key": apiKey, ...(init.headers ?? {}) } });
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.startsWith("audio/")) return { status: res.status, audio: new Uint8Array(await res.arrayBuffer()) };
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: { detail: { message: text.slice(0, 200) } } };
  }
}

function detail(result) {
  const d = result.body?.detail;
  if (!d) return `${result.status}`;
  if (typeof d === "string") return `${result.status} ${d}`;
  return `${result.status} ${d.code ?? d.status ?? ""}${d.message ? ` — ${d.message}` : ""}`;
}

function isMissingPermission(result) {
  return result.status === 401 && /missing the permission/i.test(result.body?.detail?.message ?? "");
}

function verdictForVoice(voice) {
  const category = voice.category;
  const shared = Boolean(voice.sharing?.public_owner_id || voice.sharing?.original_voice_id);
  if (category === "premade") return { usable: true, why: "current built-in default voice" };
  if (category === "generated" && !shared) return { usable: true, why: "Voice Design voice owned by this account" };
  if (category === "cloned" && !shared) return { usable: true, why: "clone owned by this account" };
  if (shared || category === "professional" || category === "famous" || category === "high_quality") {
    return { usable: false, why: "Voice Library voice — free accounts cannot use library voices via the API" };
  }
  return { usable: null, why: `category "${category}" — run --probe to be sure` };
}

console.log("ElevenLabs configuration check\n");

console.log("API key");
if (!apiKey) {
  bad("ELEVENLABS_API_KEY is not set. Copy .env.example to .env.local and fill it in.");
  process.exit(1);
}
ok(`present (${apiKey.slice(0, 3)}…${apiKey.slice(-3)}, ${apiKey.length} chars)`);

console.log("\nPlan and credits");
const sub = await request("/v1/user/subscription");
if (sub.status === 200) {
  const s = sub.body;
  const used = s.character_count ?? 0;
  const limit = s.character_limit ?? 0;
  const reset = s.next_character_count_reset_unix ? new Date(s.next_character_count_reset_unix * 1000) : null;
  ok(`tier: ${s.tier} (${s.status})`);
  info(`credits used this period: ${used.toLocaleString()} / ${limit.toLocaleString()} (${Math.max(0, limit - used).toLocaleString()} left)`);
  info(`≈ ${Math.max(0, (limit - used) / 1000).toFixed(1)} minutes of Voice Changer left at ~1 000 credits/minute`);
  if (reset) info(`quota resets: ${reset.toLocaleString()}`);
  info(`voice slots: ${s.voice_slots_used ?? "?"} / ${s.voice_limit ?? "?"}`);
  info(`instant voice cloning: ${s.can_use_instant_voice_cloning ? "yes" : "no"} · professional cloning: ${s.can_use_professional_voice_cloning ? "yes" : "no"}`);
} else if (isMissingPermission(sub)) {
  info("key lacks the `user_read` permission, so plan and remaining credits can't be shown here.");
  info("That's fine for the app. To see them: ElevenLabs dashboard → Usage, or add `user_read` to this key.");
} else if (sub.status === 401) {
  bad(`key rejected: ${detail(sub)}`);
  process.exit(1);
} else {
  bad(`unexpected response: ${detail(sub)}`);
}

console.log("\nModel");
const models = await request("/v1/models");
if (models.status === 200) {
  const model = models.body.find((m) => m.model_id === modelId);
  if (!model) bad(`${modelId} is not in the model list for this account`);
  else if (!model.can_do_voice_conversion) bad(`${modelId} does not support speech-to-speech`);
  else ok(`${modelId} supports speech-to-speech (${model.languages?.length ?? "?"} languages)`);
} else if (isMissingPermission(models)) {
  info(`key lacks \`models_read\`; assuming ${modelId} (the documented speech-to-speech model).`);
} else {
  bad(`unexpected response: ${detail(models)}`);
}

console.log("\nConfigured voices");
const configured = VOICES.map((v) => ({ ...v, id: env[v.envVar]?.trim() || null })).filter((v) => v.id);
if (configured.length === 0) {
  bad("no voice IDs configured (ELEVENLABS_VOICE_WARM_ID / _DEEP_ID / _BRIGHT_ID).");
  process.exit(1);
}

let voicesReadable = true;
for (const voice of configured) {
  const res = await request(`/v1/voices/${encodeURIComponent(voice.id)}`);
  if (res.status === 200) {
    const v = res.body;
    const verdict = verdictForVoice(v);
    const label = `${voice.slug} → "${v.name}" (${v.category}${v.sharing?.public_owner_id ? ", from Voice Library" : ""})`;
    if (verdict.usable === true) ok(`${label}: ${verdict.why}`);
    else if (verdict.usable === false) bad(`${label}: ${verdict.why}`);
    else info(`${label}: ${verdict.why}`);
  } else if (isMissingPermission(res)) {
    voicesReadable = false;
    info(`${voice.slug}: key lacks \`voices_read\`; cannot inspect the voice (ID ${voice.id.slice(0, 4)}…).`);
  } else if (res.status === 404 || res.status === 400) {
    bad(`${voice.slug}: ${detail(res)} — check the voice ID in ${voice.envVar}.`);
  } else {
    bad(`${voice.slug}: ${detail(res)}`);
  }
}
if (!voicesReadable && !PROBE) info("Run with --probe to test each voice with a real 2-second conversion.");

if (PROBE) {
  console.log("\nProbe (real speech-to-speech call, ~2 s of audio per voice)");
  const fixture = resolve(process.cwd(), "tests/fixtures/tone-2s.mp3");
  if (!existsSync(fixture)) {
    bad(`fixture not found: ${fixture}`);
    process.exit(1);
  }
  const audio = readFileSync(fixture);
  for (const voice of configured) {
    const form = new FormData();
    form.append("audio", new Blob([audio], { type: "audio/mpeg" }), "probe.mp3");
    form.append("model_id", modelId);
    const res = await request(`/v1/speech-to-speech/${encodeURIComponent(voice.id)}?output_format=mp3_44100_128`, {
      method: "POST",
      body: form,
    });
    if (res.audio) ok(`${voice.slug}: conversion succeeded (${res.audio.byteLength.toLocaleString()} bytes of MP3)`);
    else bad(`${voice.slug}: ${detail(res)}`);
  }
}

console.log(
  "\nFree-plan rules of thumb: voices you created with Voice Design and ElevenLabs' current built-in default voices work via the API;" +
    "\nvoices added from the Voice Library (including legacy defaults such as Rachel/Adam) return `paid_plan_required`.",
);
