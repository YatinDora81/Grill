import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AllKeysExhausted, AppError } from "./errors";
import { ProviderError } from "./clients/keyPool";

/** JSON response helper. */
export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

/** Map any thrown error to the uniform { error: { code, message } } shape. */
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
    // Log the underlying provider failure — without it, "all keys exhausted"
    // gives us nothing to act on.
    console.error("[api] all keys exhausted; last error:", err.lastError);
    return json(
      { error: { code: "all_keys_exhausted", message: "All provider keys failed; try again shortly." } },
      503,
    );
  }
  if (err instanceof ProviderError) {
    // An upstream provider rejecting us is not this app breaking, so it must
    // not be a 500. Keep the provider's own wording out of the response (it
    // can name projects/quotas) but log it for us.
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
