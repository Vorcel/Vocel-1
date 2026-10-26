// Busca rápida de campos numéricos (Pregão / UASG): compara SÓ os dígitos dos
// dois lados — o valor salvo e o texto digitado —, então "023/2026", "023 2026",
// "023-2026", "023.2026" e "0232026" encontram o mesmo registro.
// Descrição/Órgão continuam com a busca textual de sempre (não usam isto).
export const digitsOnly = (v) => String(v ?? "").replace(/\D/g, "");

export const matchesDigits = (value, query) => {
  const q = digitsOnly(query);
  // Busca sem nenhum dígito (ex.: só letras): cai na comparação textual, para
  // não "achar tudo" com uma busca vazia depois da normalização.
  if (!q) return String(value ?? "").toLowerCase().includes(String(query ?? "").trim().toLowerCase());
  return digitsOnly(value).includes(q);
};
