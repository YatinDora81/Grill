import type { Session } from "@repo/db";
import type { InterviewConfig, InterviewMode, SourceType } from "@repo/types";
import { storedConfigSchema } from "@/lib/schemas";
import type { SessionContext } from "@/lib/prompts/questionGen";

/**
 * Sessions created before modes existed have no `mode` in their config, and
 * their source_text may be a job description or a topic rather than a résumé.
 * Deriving the mode from the old source_type keeps those interviews coherent if
 * someone resumes one — the default ("résumé") would otherwise tell the prompt
 * that a pasted job description is the candidate's own history.
 */
const LEGACY_MODE: Record<SourceType, InterviewMode> = {
  resume: "resume",
  jd: "jd",
  topic: "topic_only",
};

/** Build the prompt-facing context from a persisted session row. */
export function toSessionContext(session: Session): SessionContext {
  // Copied, not mutated in place: `session.config` is the Prisma row's own
  // object, and editing it would leak these back-fills into anything else
  // holding that row.
  const raw = { ...((session.config ?? {}) as Record<string, unknown>) };

  // The oldest shape of all: no mode, no sources, just a source_type. This has
  // to run before the config migration, which would otherwise read the absence
  // of a mode as "résumé" and hand a job description to the prompt as history.
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
