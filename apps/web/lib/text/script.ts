const NON_LATIN_TOLERANCE = 0.2;

export function isLatinScript(text: string): boolean {
  const letters = text.match(/\p{L}/gu);
  if (!letters?.length) return true;
  const nonLatin = letters.filter((ch) => !/\p{Script=Latin}/u.test(ch)).length;
  return nonLatin / letters.length <= NON_LATIN_TOLERANCE;
}
