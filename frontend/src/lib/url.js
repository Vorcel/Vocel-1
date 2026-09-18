// Helpers da coluna "Site" do orçamento: normalização, exibição abreviada e
// href seguro. O valor salvo é sempre a URL completa (com protocolo); a
// remoção de "https://" é apenas visual.

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const HTTP_RE = /^https?:\/\//i;

// Normaliza o que o usuário digitou/colou para gravação:
// - vazio -> "" (remoção do link também é salva)
// - sem protocolo ("www.x.com/p", "x.com/p") -> "https://..."
// - com http/https -> mantém como está
// - com outro esquema (javascript:, ftp:, mailto:) -> mantém o texto, mas não vira link clicável
export function normalizeUrl(input) {
  const v = String(input ?? "").trim();
  if (!v) return "";
  if (HTTP_RE.test(v)) return v;
  if (SCHEME_RE.test(v)) return v;
  return "https://" + v.replace(/^\/+/, "");
}

// Só http/https viram href; qualquer outra coisa (ex.: javascript:) devolve null.
export function safeHref(value) {
  const v = String(value ?? "").trim();
  if (!HTTP_RE.test(v)) return null;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:" ? v : null;
  } catch {
    return null;
  }
}

// Texto exibido: sem "http(s)://" e sem "/" final. O truncamento com "..."
// fica por conta do CSS (truncate) — o endereço completo vai no tooltip.
export function displayUrl(value) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  return v.replace(HTTP_RE, "").replace(/\/+$/, "");
}
