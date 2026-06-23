// Smart Title Case (pt-BR) — função ÚNICA de formatação de texto livre do sistema.
// Capitaliza a 1ª letra de cada palavra, exceto preposições/conjunções/artigos
// curtos (minúsculos, salvo a 1ª palavra) e preservando siglas (tokens com 2+
// letras totalmente em maiúsculas, ex.: CNPJ, UASG, ME, EPP, ICMS).
const LOWER = new Set([
  "de", "da", "do", "das", "dos", "a", "o", "as", "os", "e",
  "em", "na", "no", "nas", "nos", "com", "por", "para",
]);

// Sigla: token cujas letras são todas maiúsculas e há ao menos 2 letras.
// Mantém exatamente como foi digitado (não altera maiúsculas/minúsculas).
function isAcronym(tok) {
  const letters = tok.replace(/[^\p{L}]/gu, "");
  return letters.length >= 2 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
}

export function smartTitleCase(str) {
  if (!str) return str;
  let wordIdx = 0;
  return str
    .split(/(\s+)/)
    .map((tok) => {
      if (tok.trim() === "") return tok; // preserva espaços
      const isFirst = wordIdx === 0;
      wordIdx += 1;
      if (isAcronym(tok)) return tok; // siglas: CNPJ, UASG, ME, EPP, IBGE...
      const lower = tok.toLowerCase();
      if (!isFirst && LOWER.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");
}
