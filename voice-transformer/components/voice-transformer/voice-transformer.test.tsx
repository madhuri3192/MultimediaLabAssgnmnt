// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicVoice } from "@/lib/voices/config";
import { QUOTA_EXHAUSTED_MESSAGE } from "@/lib/api/errors";
import { transformerReducer, VoiceTransformer, type TransformerState } from "./voice-transformer";

vi.mock("@/lib/audio/duration", () => ({
  getAudioDuration: vi.fn(async (blob: Blob) => ((blob as File).name?.startsWith("long") ? 42 : 4.2)),
}));

const voices: PublicVoice[] = [
  { slug: "warm-narrator", name: "Warm Narrator", description: "Natural, calm and expressive." },
  { slug: "deep-studio", name: "Deep Studio", description: "Lower, cinematic delivery." },
];
const limits = { maxDurationSeconds: 30, maxSizeBytes: 15 * 1024 * 1024 };

type Listener = (() => void) | null;

class MockMediaRecorder {
  static isTypeSupported = (type: string) => type === "audio/webm;codecs=opus";
  static instances: MockMediaRecorder[] = [];
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  onstart: Listener = null;
  onstop: Listener = null;
  onerror: Listener = null;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;

  constructor(
    public stream: MediaStream,
    options?: { mimeType?: string },
  ) {
    this.mimeType = options?.mimeType ?? "";
    MockMediaRecorder.instances.push(this);
  }

  start() {
    this.state = "recording";
    this.onstart?.();
  }

  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([new Uint8Array(2048)], { type: this.mimeType }) });
    this.onstop?.();
  }
}

const trackStop = vi.fn();
const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: trackStop }] }) as unknown as MediaStream);

function mp3Response(status = 200) {
  return new Response(new Uint8Array([0xff, 0xfb, 0x90, 0x00]), {
    status,
    headers: { "content-type": "audio/mpeg", "x-processing-ms": "120", "x-provider-ms": "80" },
  });
}

function jsonError(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  MockMediaRecorder.instances = [];
  fetchMock = vi.fn(async () => mp3Response());
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("MediaRecorder", MockMediaRecorder);
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  let counter = 0;
  URL.createObjectURL = vi.fn(() => `blob:mock/${(counter += 1)}`);
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function recordAndStop(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /record voice/i }));
  await screen.findByRole("button", { name: /stop recording/i });
  await user.click(screen.getByRole("button", { name: /stop recording/i }));
  await screen.findByText("Your recording");
}

describe("VoiceTransformer", () => {
  it("renders the configured voices with the first one selected", () => {
    render(<VoiceTransformer voices={voices} limits={limits} />);
    expect(screen.getByRole("radio", { name: /warm narrator/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /deep studio/i })).not.toBeChecked();
    expect(screen.getByRole("tab", { name: /record/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: /record voice/i })).toBeEnabled();
  });

  it("walks idle → recording → source ready → processing → result", async () => {
    const user = userEvent.setup();
    render(<VoiceTransformer voices={voices} limits={limits} />);

    await user.click(screen.getByRole("radio", { name: /deep studio/i }));

    await user.click(screen.getByRole("button", { name: /record voice/i }));
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Recording")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("00:00 / 00:30");

    await user.click(screen.getByRole("button", { name: /stop recording/i }));
    expect(trackStop).toHaveBeenCalled();
    expect(await screen.findByText("Your recording")).toBeInTheDocument();

    const transform = screen.getByRole("button", { name: /transform voice/i });
    expect(transform).toBeEnabled();
    await user.click(transform);

    expect(await screen.findByText("Your transformed voice is ready.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /download mp3/i })).toHaveAttribute("download", expect.stringMatching(/^voice-conversion-.*\.mp3$/));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/convert");
    const form = init.body as FormData;
    expect(form.get("voiceSlug")).toBe("deep-studio");
    expect(form.get("audio")).toBeInstanceOf(Blob);
    expect((form.get("audio") as File).name).toBe("recording.webm");

    await user.click(screen.getByRole("button", { name: /transform another recording/i }));
    expect(screen.getByRole("button", { name: /record voice/i })).toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it("shows a quota error with a retry path that succeeds", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonError(429, "quota-exhausted", QUOTA_EXHAUSTED_MESSAGE));
    render(<VoiceTransformer voices={voices} limits={limits} />);

    await recordAndStop(user);
    await user.click(screen.getByRole("button", { name: /transform voice/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Demo usage limit reached");
    expect(alert).toHaveTextContent(QUOTA_EXHAUSTED_MESSAGE);
    expect(screen.getByText("Your recording")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByText("Your transformed voice is ready.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("explains a denied microphone and keeps the recorder available", async () => {
    const user = userEvent.setup();
    getUserMedia.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    render(<VoiceTransformer voices={voices} limits={limits} />);

    await user.click(screen.getByRole("button", { name: /record voice/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Microphone access was blocked");
    expect(screen.getByRole("button", { name: /record voice/i })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("accepts an upload, requires consent, and transforms it", async () => {
    const user = userEvent.setup();
    render(<VoiceTransformer voices={voices} limits={limits} />);

    await user.click(screen.getByRole("tab", { name: /upload/i }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array(4096)], "take-one.mp3", { type: "audio/mpeg" });
    await user.upload(input, file);

    expect(await screen.findByText("take-one.mp3")).toBeInTheDocument();
    expect(screen.getByText(/4\.2 seconds/)).toBeInTheDocument();
    const transform = screen.getByRole("button", { name: /transform voice/i });
    expect(transform).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: /permission to use this recording/i }));
    expect(transform).toBeEnabled();
    await user.click(transform);

    expect(await screen.findByText("Your transformed voice is ready.")).toBeInTheDocument();
    const form = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect((form.get("audio") as File).name).toBe("take-one.mp3");
  });

  it("rejects an upload that is too long before anything is sent", async () => {
    const user = userEvent.setup();
    render(<VoiceTransformer voices={voices} limits={limits} />);

    await user.click(screen.getByRole("tab", { name: /upload/i }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File([new Uint8Array(4096)], "long-take.mp3", { type: "audio/mpeg" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This recording is 42 seconds long. The MVP currently supports up to 30 seconds.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported files immediately", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<VoiceTransformer voices={voices} limits={limits} />);

    await user.click(screen.getByRole("tab", { name: /upload/i }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File([new Uint8Array(10)], "notes.txt", { type: "text/plain" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This audio format is not supported");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("transformerReducer", () => {
  const source = {
    blob: new Blob([new Uint8Array(4)]),
    url: "blob:mock/source",
    durationSeconds: 5,
    mimeType: "audio/webm",
    fileName: "recording.webm",
    origin: "recording" as const,
  };

  it("keeps the source when a conversion fails and restores it on retry", () => {
    let state: TransformerState = { phase: "source-ready", source };
    state = transformerReducer(state, { type: "processing-started", startedAt: 0 });
    expect(state.phase).toBe("processing");
    state = transformerReducer(state, { type: "failed", error: { code: "x", title: "t", message: "m" } });
    expect(state).toMatchObject({ phase: "error", source });
    state = transformerReducer(state, { type: "retry" });
    expect(state).toEqual({ phase: "source-ready", source });
  });

  it("ignores stale processing events once the request was cancelled", () => {
    let state: TransformerState = { phase: "processing", source, step: "preparing", startedAt: 0 };
    state = transformerReducer(state, { type: "processing-cancelled" });
    expect(state.phase).toBe("source-ready");
    const unchanged = transformerReducer(state, { type: "processing-step", step: "finalizing" });
    expect(unchanged).toBe(state);
  });
});
