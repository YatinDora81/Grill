export const FILLER_WORDS = ["um", "uh", "uhh", "umm", "erm", "hmm", "mhm", "you know", "i mean"];

export const LIKE_LITERAL_BEFORE =
  /\b(would|'d|do|does|did|really|don't|didn't|feel|feels|felt|look|looks|looked|sound|sounds|sounded|seem|seems|seemed|smell|taste|act|acts|much|just)$/;
export const LIKE_LITERAL_AFTER =
  /^\s+(to|this|that|these|those|it|them|him|her|us|me|you|a|an|the|my|your|our|their|his|its|what|how|when|where|why|who|which)\b/;

const FILLER_PHRASES = FILLER_WORDS.map((filler) => filler.split(" "));

export function normalizeFillerWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z']/g, "");
}

export interface FillerMatches {
  flagged: boolean[];
  occurrences: number;
}

export function findFillerWords(words: string[]): FillerMatches {
  const tokens = words.map(normalizeFillerWord);
  const flagged = new Array<boolean>(tokens.length).fill(false);
  let occurrences = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (!token) continue;

    if (token === "like") {
      if (!likeReadsLiteral(tokens, i)) {
        flagged[i] = true;
        occurrences++;
      }
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
      for (let k = 0; k < phrase.length; k++) flagged[i + k] = true;
      occurrences++;
      break;
    }
  }

  return { flagged, occurrences };
}

function likeReadsLiteral(tokens: string[], i: number): boolean {
  const before = tokens.slice(0, i).join(" ");
  const after = tokens.slice(i + 1).join(" ");
  return LIKE_LITERAL_BEFORE.test(before) || LIKE_LITERAL_AFTER.test(` ${after}`);
}
