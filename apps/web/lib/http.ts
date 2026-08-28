import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AllKeysExhausted, AppError } from "./errors";
import { ProviderError } from "./clients/keyPool";

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ZodError) {
    return json(
      {
        error: {
          code: "validation_error",
          message: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        },
      },
      400,
    );
  }
  if (err instanceof AppError) {
    return json({ error: { code: err.code, message: err.message } }, err.status);
  }
  if (err instanceof AllKeysExhausted) {
    console.error("[api] all keys exhausted; last error:", err.lastError);
    return json(
      { error: { code: "all_keys_exhausted", message: "All provider keys failed; try again shortly." } },
      503,
    );
  }
  if (err instanceof ProviderError) {
    console.error("[api] provider error:", err.status, err.message);
    return json(
      {
        error: {
          code: "provider_error",
          message:
            err.status === 429
              ? "The AI provider is rate-limiting us. Try again in a moment."
              : "The AI provider rejected the request — a server-side key or quota problem, not your answer.",
        },
      },
      503,
    );
  }
  console.error("[api] unhandled error:", err);
  return json({ error: { code: "internal_error", message: "Something went wrong." } }, 500);
}
