import type { Session } from "@repo/db";
import type { InterviewConfig, InterviewMode, SourceType } from "@repo/types";
import { interviewConfigSchema } from "@/lib/schemas";
import type { SessionContext } from "@/lib/prompts/questionGen";

/**
 * Sessions created before modes existed have no `mode` in their config, and
 * their source_text may be a job description or a topic rather than a résumé.
 * Deriving the mode from the old source_type keeps those interviews coherent if
 * someone resumes one — the schema default ("resume") would otherwise tell the
 * prompt that a pasted job description is the candidate's own history.
 */
const LEGACY_MODE: Record<SourceType, InterviewMode> = {
  resume: "resume",
  jd: "jd",
  topic: "topic_only",
};

/** Build the prompt-facing context from a persisted session row. */
export function toSessionContext(session: Session): SessionContext {
  const raw = (session.config ?? {}) as Record<string, unknown>;
  const config = interviewConfigSchema.parse(raw) as InterviewConfig;

  if (raw.mode === undefined) {
    config.mode = LEGACY_MODE[session.sourceType];
    // A legacy `jd`/`topic` session keeps its text where the prompt expects it.
    if (config.mode === "jd" && !config.job_description) {
      config.job_description = session.sourceText;
    }
    if (config.mode === "topic_only" && !config.topic) {
      config.topic = session.sourceText;
    }
  }

  return {
    sourceType: session.sourceType,
    sourceText: session.sourceText,
    role: session.role,
    config,
  };
}
