import type { DiffOp } from "@repo/types";

export const MAX_DIFF_CELLS = 400_000;

export function tokenizeWords(text: string): string[] {
  return text.split(/\s+/).filter((w) => w.length > 0);
}

export function normalizeToken(token: string): string {
  const stripped = token.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  return stripped || token.toLowerCase();
}

export function diffWords(a: string[], b: string[]): DiffOp[] {
  if (a.length === 0 && b.length === 0) return [];
  if (a.length === 0) return [{ op: "add", text: b.join(" ") }];
  if (b.length === 0) return [{ op: "del", text: a.join(" ") }];

  if (a.length * b.length > MAX_DIFF_CELLS) {
    return [
      { op: "del", text: a.join(" ") },
      { op: "add", text: b.join(" ") },
    ];
  }

  const ka = a.map(normalizeToken);
  const kb = b.map(normalizeToken);
  const n = a.length;
  const m = b.length;
  const width = m + 1;

  const lcs = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] =
        ka[i] === kb[j]
          ? lcs[(i + 1) * width + j + 1]! + 1
          : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
    }
  }

  const ops: DiffOp[] = [];
  let run: string[] = [];
  let runOp: DiffOp["op"] | null = null;
  const push = (op: DiffOp["op"], text: string) => {
    if (op !== runOp) {
      if (runOp !== null) ops.push({ op: runOp, text: run.join(" ") });
      runOp = op;
      run = [];
    }
    run.push(text);
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (ka[i] === kb[j]) {
      push("keep", b[j]!);
      i++;
      j++;
    } else if (lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!) {
      push("del", a[i]!);
      i++;
    } else {
      push("add", b[j]!);
      j++;
    }
  }
  while (i < n) push("del", a[i++]!);
  while (j < m) push("add", b[j++]!);
  if (runOp !== null) ops.push({ op: runOp, text: run.join(" ") });

  return ops;
}
