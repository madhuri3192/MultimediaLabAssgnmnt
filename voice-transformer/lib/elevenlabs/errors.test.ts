import { describe, expect, it } from "vitest";
import { mapElevenLabsHttpError, parseElevenLabsErrorBody } from "./errors";

const body = (detail: Record<string, unknown> | string) => JSON.stringify({ detail });

describe("parseElevenLabsErrorBody", () => {
  it("reads legacy status and new code fields", () => {
    expect(parseElevenLabsErrorBody(body({ status: "quota_exceeded", message: "m" }))).toEqual({
      status: "quota_exceeded",
      code: null,
      message: "m",
    });
    expect(parseElevenLabsErrorBody(body({ code: "insufficient_credits" }))).toMatchObject({ code: "insufficient_credits" });
  });

  it("tolerates string details, non-JSON and empty bodies", () => {
    expect(parseElevenLabsErrorBody(body("Not found"))).toMatchObject({ message: "Not found" });
    expect(parseElevenLabsErrorBody("<html>oops</html>")).toMatchObject({ message: "<html>oops</html>" });
    expect(parseElevenLabsErrorBody("")).toEqual({ status: null, code: null, message: null });
  });
});

describe("mapElevenLabsHttpError", () => {
  it("maps quota exhaustion from both the legacy and new identifiers", () => {
    expect(mapElevenLabsHttpError(401, body({ status: "quota_exceeded" })).code).toBe("quota");
    expect(mapElevenLabsHttpError(402, body({ code: "insufficient_credits" })).code).toBe("quota");
    expect(mapElevenLabsHttpError(402, "").code).toBe("quota");
  });

  it("maps authentication failures", () => {
    const error = mapElevenLabsHttpError(401, body({ status: "invalid_api_key" }));
    expect(error.code).toBe("auth");
    expect(error.providerStatus).toBe(401);
    expect(error.providerCode).toBe("invalid_api_key");
  });

  it("maps rate limiting and concurrency limits", () => {
    expect(mapElevenLabsHttpError(429, body({ status: "too_many_concurrent_requests" })).code).toBe("rate-limit");
    expect(mapElevenLabsHttpError(429, body({ code: "system_busy" })).code).toBe("rate-limit");
    expect(mapElevenLabsHttpError(429, "").code).toBe("rate-limit");
  });

  it("maps plan restrictions separately from quota, keeping the provider message for logs", () => {
    // Exact payload ElevenLabs returns on the free plan for a Voice Library voice.
    const error = mapElevenLabsHttpError(
      402,
      body({
        type: "payment_required",
        code: "paid_plan_required",
        message: "Free users cannot use library voices via the API. Please upgrade your subscription to use this voice.",
        status: "payment_required",
      }),
    );
    expect(error.code).toBe("plan-required");
    expect(error.providerCode).toBe("paid_plan_required");
    expect(error.providerMessage).toContain("library voices");
    expect(mapElevenLabsHttpError(401, body({ status: "free_users_not_allowed" })).code).toBe("plan-required");
  });

  it("maps missing voices and permission problems", () => {
    expect(mapElevenLabsHttpError(404, body({ code: "voice_not_found" })).code).toBe("voice-not-found");
    expect(mapElevenLabsHttpError(400, body({ status: "voice_not_found" })).code).toBe("voice-not-found");
    expect(mapElevenLabsHttpError(401, body({ status: "missing_permissions" })).code).toBe("permission");
    expect(mapElevenLabsHttpError(403, "").code).toBe("permission");
  });

  it("maps audio problems and generic upstream failures", () => {
    expect(mapElevenLabsHttpError(400, body({ code: "invalid_audio" })).code).toBe("invalid-audio");
    expect(mapElevenLabsHttpError(422, "").code).toBe("invalid-request");
    expect(mapElevenLabsHttpError(500, "").code).toBe("upstream");
    expect(mapElevenLabsHttpError(503, body({ code: "maintenance" })).code).toBe("upstream");
  });

  it("never embeds the response body in the message", () => {
    const error = mapElevenLabsHttpError(500, body({ message: "internal secret detail" }));
    expect(error.message).not.toContain("internal secret detail");
  });
});
