import type { ApiError } from "@repo/types";

/**
 * Browser-side API helper. Every route returns the same error envelope
 * ({ error: { code, message } }), so unwrap it once here and let callers just
 * catch — no per-screen error parsing.
 */
export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiClientError(
      "The server returned a response we couldn't read.",
      "bad_response",
      res.status,
    );
  }
  if (!res.ok) {
    const err = (body as ApiError)?.error;
    throw new ApiClientError(
      err?.message ?? "Something went wrong.",
      err?.code ?? "unknown",
      res.status,
    );
  }
  return body as T;
}

export async function apiPost<T>(path: string, payload: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return unwrap<T>(res);
}

export async function apiPostForm<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(path, { method: "POST", body: form });
  return unwrap<T>(res);
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  return unwrap<T>(res);
}
