"use client";

import { Toaster, type ToastOptions } from "react-hot-toast";

/**
 * Toasts, in the room's own colours. The library's defaults are a white pill —
 * on this surface that reads as a hole in the page.
 *
 * Values come from the theme's CSS variables rather than hex literals so the
 * toast can never drift from the rest of the room. `var()` in an inline style
 * resolves against whatever scope the toast is mounted in, and all three mount
 * sites want that: the hot seat's copy sits under `.room-root` and stays dark
 * in both themes, while the report's and the profile's follow the page onto the
 * sheet.
 *
 * The shadow is a whole shadow VALUE rather than a colour because light needs
 * different geometry as well as a different alpha — two tight warm layers
 * instead of one deep black one. On cream the toast is a near-white card on a
 * near-white ground and that lift is the only thing separating them, where on
 * black the border alone would do.
 */
const SURFACE: ToastOptions["style"] = {
  background: "var(--color-paper-raised)",
  color: "var(--color-ink)",
  border: "1px solid var(--color-line)",
  borderRadius: "12px",
  fontSize: "14px",
  maxWidth: "420px",
  padding: "10px 14px",
  boxShadow: "var(--shadow-toast)",
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
