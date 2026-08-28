import type { Session } from "@repo/db";
import type { InterviewConfig, InterviewMode, SourceType } from "@repo/types";
import { storedConfigSchema } from "@/lib/schemas";
import type { SessionContext } from "@/lib/prompts/questionGen";

const LEGACY_MODE: Record<SourceType, InterviewMode> = {
  resume: "resume",
  jd: "jd",
  topic: "topic_only",
};

export function toSessionContext(session: Session): SessionContext {
  const raw = { ...((session.config ?? {}) as Record<string, unknown>) };

  if (raw.mode === undefined && raw.sources === undefined) {
    raw.mode = LEGACY_MODE[session.sourceType];
    if (raw.mode === "jd" && !raw.job_description) raw.job_description = session.sourceText;
    if (raw.mode === "topic_only" && !raw.topic) raw.topic = session.sourceText;
  }

  return {
    sourceType: session.sourceType,
    sourceText: session.sourceText,
    role: session.role,
    config: storedConfigSchema.parse(raw) as InterviewConfig,
  };
}
