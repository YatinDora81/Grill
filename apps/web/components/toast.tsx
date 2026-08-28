"use client";

import { Toaster, type ToastOptions } from "react-hot-toast";

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
