"use client";

import { Toaster, type ToastOptions } from "react-hot-toast";

/**
 * Toasts, in the room's own colours. The library's defaults are a white pill —
 * on this surface that reads as a hole in the page.
 *
 * Values come from the theme's CSS variables rather than hex literals so the
 * toast can never drift from the rest of the room.
 */
const SURFACE: ToastOptions["style"] = {
  background: "var(--color-paper-raised)",
  color: "var(--color-ink)",
  border: "1px solid var(--color-line)",
  borderRadius: "12px",
  fontSize: "14px",
  maxWidth: "420px",
  padding: "10px 14px",
  boxShadow: "0 22px 60px -32px rgba(0, 0, 0, 0.85)",
};

export function GrillToaster() {
  return (
    <Toaster
      position="bottom-center"
      gutter={10}
      toastOptions={{
        style: SURFACE,
        // Ember while in flight: the spinner is the one hot thing on screen
        // while an answer is uploading.
        loading: {
          iconTheme: { primary: "var(--color-ember)", secondary: "var(--color-paper-raised)" },
        },
        success: {
          duration: 1600,
          iconTheme: { primary: "var(--color-strong)", secondary: "var(--color-paper-raised)" },
        },
        error: {
          duration: 5000,
          iconTheme: { primary: "var(--color-weak)", secondary: "var(--color-paper-raised)" },
        },
      }}
    />
  );
}
