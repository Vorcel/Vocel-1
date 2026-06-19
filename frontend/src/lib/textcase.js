// Smart Title Case (pt-BR): capitaliza a primeira letra de cada palavra, exceto
// preposições/conjunções/artigos curtos — que ficam minúsculos, salvo a 1ª palavra.
const LOWER = new Set([
  "de", "da", "do", "das", "dos", "a", "o", "as", "os", "e",
  "em", "na", "no", "nas", "nos", "com", "por", "para",
]);

export function smartTitleCase(str) {
  if (!str) return str;
  let wordIdx = 0;
  return str
    .split(/(\s+)/)
    .map((tok) => {
      if (tok.trim() === "") return tok; // preserva espaços
      const lower = tok.toLowerCase();
      const isFirst = wordIdx === 0;
      wordIdx += 1;
      if (!isFirst && LOWER.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");
}
