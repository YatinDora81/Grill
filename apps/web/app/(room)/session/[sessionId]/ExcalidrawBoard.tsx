"use client";

import dynamic from "next/dynamic";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

const Excalidraw = dynamic(async () => (await import("@excalidraw/excalidraw")).Excalidraw, {
  ssr: false,
  loading: () => <div className="board-loading">Loading the board…</div>,
});

export function ExcalidrawBoard({
  theme,
  onReady,
  onChange,
}: {
  theme: "light" | "dark";
  onReady: (api: ExcalidrawImperativeAPI) => void;
  onChange?: (elementCount: number) => void;
}) {
  return (
    <div className="board-wrap">
      <Excalidraw
        excalidrawAPI={onReady}
        theme={theme}
        onChange={(els) => onChange?.(els.filter((e) => !e.isDeleted).length)}
        UIOptions={{
          canvasActions: {
            loadScene: false,
            saveToActiveFile: false,
            export: false,
            saveAsImage: false,
          },
        }}
      />
    </div>
  );
}
