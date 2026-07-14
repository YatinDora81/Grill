import "server-only";
/**
 * Resume text extraction. Optional helper for source_type = "resume": accept an
 * uploaded PDF/DOCX/TXT and return plain text to use as source_text.
 */
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { badRequest } from "@/lib/errors";

export async function extractResumeText(
  bytes: Uint8Array,
  mime: string,
  filename: string,
): Promise<string> {
  const name = filename.toLowerCase();
  const isPdf = mime.includes("pdf") || name.endsWith(".pdf");
  const isDocx = mime.includes("officedocument.wordprocessingml") || name.endsWith(".docx");
  const isText = mime.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md");

  let text: string;
  if (isPdf) {
    const pdf = await getDocumentProxy(bytes);
    const res = await extractText(pdf, { mergePages: true });
    text = Array.isArray(res.text) ? res.text.join("\n") : res.text;
  } else if (isDocx) {
    const res = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    text = res.value;
  } else if (isText) {
    text = Buffer.from(bytes).toString("utf8");
  } else {
    throw badRequest(`Unsupported resume type: ${mime || filename}. Use PDF, DOCX, or TXT.`, "bad_resume_type");
  }

  text = text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  if (text.length < 20) {
    throw badRequest("Could not extract meaningful text from the resume.", "empty_resume");
  }
  return text;
}
