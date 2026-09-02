"use client";

import type { ReactNode } from "react";

type Block =
  | { kind: "code"; text: string }
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "numbers"; items: string[] }
  | { kind: "para"; text: string };

const FENCE = /^\s*```/;
const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;
const INLINE = /(`[^`]+`|\*\*[^*]+\*\*)/g;

const HEADING_CLASS: Record<1 | 2 | 3, string> = {
  1: "mt-5 font-display text-[17px] leading-tight font-bold tracking-[-0.01em] first:mt-0",
  2: "mt-5 font-display text-[15px] leading-tight font-bold tracking-[-0.01em] first:mt-0",
  3: "mt-4 font-mono text-[11px] tracking-[0.14em] uppercase text-ink-muted first:mt-0",
};

function blocksOf(text: string): Block[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let bullets: string[] = [];
  let numbers: string[] = [];

  const flush = () => {
    if (para.length) blocks.push({ kind: "para", text: para.join(" ") });
    if (bullets.length) blocks.push({ kind: "bullets", items: bullets });
    if (numbers.length) blocks.push({ kind: "numbers", items: numbers });
    para = [];
    bullets = [];
    numbers = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (FENCE.test(line)) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i]!)) {
        body.push(lines[i]!);
        i++;
      }
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({
        kind: "heading",
        level: heading[1]!.length as 1 | 2 | 3,
        text: heading[2]!.trim(),
      });
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      if (para.length || numbers.length) flush();
      bullets.push(bullet[1]!);
      continue;
    }

    const numbered = NUMBER.exec(line);
    if (numbered) {
      if (para.length || bullets.length) flush();
      numbers.push(numbered[1]!);
      continue;
    }

    if (bullets.length || numbers.length) flush();
    para.push(line.trim());
  }

  flush();
  return blocks;
}

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 1) {
      return (
        <code
          key={i}
          className="border border-line bg-paper-sunken px-1 py-px font-mono text-[0.9em] text-ink"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 3) {
      return (
        <b key={i} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </b>
      );
    }
    return part;
  });
}

export function MiniMarkdown({ text }: { text: string }) {
  return (
    <div className="text-[14px] leading-relaxed text-ink-soft">
      {blocksOf(text).map((block, i) => {
        if (block.kind === "code") {
          return (
            <pre key={i} className="code-src mt-3">
              {block.text}
            </pre>
          );
        }
        if (block.kind === "heading") {
          const Tag = block.level === 1 ? "h2" : block.level === 2 ? "h3" : "h4";
          return (
            <Tag key={i} className={HEADING_CLASS[block.level]}>
              {inline(block.text)}
            </Tag>
          );
        }
        if (block.kind === "bullets") {
          return (
            <ul key={i} className="mt-3 list-disc pl-5">
              {block.items.map((item, j) => (
                <li key={j} className="mt-1 first:mt-0">
                  {inline(item)}
                </li>
              ))}
            </ul>
          );
        }
        if (block.kind === "numbers") {
          return (
            <ol key={i} className="mt-3 list-decimal pl-5">
              {block.items.map((item, j) => (
                <li key={j} className="mt-1 first:mt-0">
                  {inline(item)}
                </li>
              ))}
            </ol>
          );
        }
        return (
          <p key={i} className="mt-3 first:mt-0">
            {inline(block.text)}
          </p>
        );
      })}
    </div>
  );
}
