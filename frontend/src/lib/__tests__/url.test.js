import { normalizeUrl, safeHref, displayUrl } from "@/lib/url";

test("normalizeUrl: acrescenta https:// só quando falta protocolo", () => {
  expect(normalizeUrl("www.exemplo.com.br/produto")).toBe("https://www.exemplo.com.br/produto");
  expect(normalizeUrl("exemplo.com.br/produto")).toBe("https://exemplo.com.br/produto");
  expect(normalizeUrl("  https://www.exemplo.com.br/produto/12345  ")).toBe("https://www.exemplo.com.br/produto/12345");
  expect(normalizeUrl("HTTP://x.com")).toBe("HTTP://x.com");
  expect(normalizeUrl("")).toBe("");
  expect(normalizeUrl("   ")).toBe("");
  expect(normalizeUrl(null)).toBe("");
});

test("safeHref: só http/https viram link", () => {
  expect(safeHref("https://www.exemplo.com.br/produto")).toBe("https://www.exemplo.com.br/produto");
  expect(safeHref("http://x.com")).toBe("http://x.com");
  expect(safeHref("javascript:alert(1)")).toBeNull();
  expect(safeHref("ftp://x.com")).toBeNull();
  expect(safeHref("")).toBeNull();
  expect(safeHref("https://")).toBeNull();
});

test("displayUrl: remove só o protocolo (visual) e a barra final", () => {
  expect(displayUrl("https://www.exemplo.com.br/produto/12345")).toBe("www.exemplo.com.br/produto/12345");
  expect(displayUrl("http://exemplo.com.br/")).toBe("exemplo.com.br");
  expect(displayUrl("www.exemplo.com.br")).toBe("www.exemplo.com.br");
  expect(displayUrl("")).toBe("");
  expect(displayUrl(undefined)).toBe("");
});
