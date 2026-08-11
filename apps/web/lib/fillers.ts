/**
 * Only words that are ~always fillers. Words like "actually", "basically",
 * "literally", "right", "sort of" and "kind of" were deliberately removed: they
 * are ordinary vocabulary ("that's right", "it literally doubled", "sort of
 * request") and counting them inflated filler_count well past reality. Since the
 * count is handed to the report LLM as a measured fact, over-counting is not a
 * harmless rounding error — it produces a dishonest delivery verdict.
 */
export const FILLER_WORDS = ["um", "uh", "uhh", "umm", "erm", "hmm", "mhm", "you know", "i mean"];

/**
 * "like" is the most common real filler in speech, so we can't just drop it —
 * but most occurrences are legitimate. Count it only where a filler is plausible
 * and a literal reading isn't: skip comparative/verb uses ("I'd like to", "looks
 * like a", "like this"). Errs toward under-counting, which is the safer bias.
 */
export const LIKE_LITERAL_BEFORE =
  /\b(would|'d|do|does|did|really|don't|didn't|feel|feels|felt|look|looks|looked|sound|sounds|sounded|seem|seems|seemed|smell|taste|act|acts|much|just)$/;
export const LIKE_LITERAL_AFTER =
  /^\s+(to|this|that|these|those|it|them|him|her|us|me|you|a|an|the|my|your|our|their|his|its|what|how|when|where|why|who|which)\b/;

const FILLER_PHRASES = FILLER_WORDS.map((filler) => filler.split(" "));

export function normalizeFillerWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z']/g, "");
}

export function fillerWordFlags(words: string[]): boolean[] {
  const tokens = words.map(normalizeFillerWord);
  const flags = new Array<boolean>(tokens.length).fill(false);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (!token) continue;

    if (token === "like") {
      if (!likeReadsLiteral(tokens, i)) flags[i] = true;
      continue;
    }

    for (const phrase of FILLER_PHRASES) {
      if (phrase[0] !== token) continue;
      let matched = true;
      for (let k = 1; k < phrase.length; k++) {
        if (tokens[i + k] !== phrase[k]) {
          matched = false;
          break;
        }
      }
      if (!matched) continue;
      for (let k = 0; k < phrase.length; k++) flags[i + k] = true;
      break;
    }
  }

  return flags;
}

function likeReadsLiteral(tokens: string[], i: number): boolean {
  const before = tokens.slice(0, i).join(" ");
  const after = tokens.slice(i + 1).join(" ");
  return LIKE_LITERAL_BEFORE.test(before) || LIKE_LITERAL_AFTER.test(` ${after}`);
}
