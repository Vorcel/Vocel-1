// Permissões do usuário logado (espelho das chaves de backend/permissions.py).
// ATENÇÃO: isto é só UX (esconder menus/botões). A segurança está no backend,
// que valida TODA requisição — esconder um botão não libera nem bloqueia nada.

export function makeCan(user) {
  const owner = !!user?.is_owner;
  const set = new Set(user?.permissions || []);
  const can = (key) => owner || set.has(key);
  const canAny = (...keys) => owner || keys.flat().some((k) => set.has(k));
  return { can, canAny, isOwner: owner };
}

// Financeiro: qualquer permissão do módulo abre o layout.
export const FIN_PREFIX = "finance.";
export const hasAnyFinance = (user) =>
  !!user?.is_owner || (user?.permissions || []).some((k) => k.startsWith(FIN_PREFIX));

// Seções da Configuração do Financeiro → permissão de leitura.
export const FIN_SETTINGS_PERMS = {
  categorias: ["finance.categories.view"],
  "estrutura-dre": ["finance.dre.configure"],
  tags: ["finance.tags.view"],
  "clientes-fornecedores": ["finance.contacts.view"],
  contas: ["finance.banks.view", "finance.cards.view"],
  formas: ["finance.forms.view"],
  preferencias: ["config.preferences.edit"],
};

// Rotas → permissão (qualquer uma das chaves libera). Rotas fora daqui: qualquer membro.
export const ROUTE_PERMS = [
  { path: "/", perms: ["licitacoes.view"] },
  { path: "/licitacoes", perms: ["licitacoes.view"] },
  { path: "/execucao", perms: ["execution.view"] },
  { path: "/analises", perms: ["analytics.view"] },
  { path: "/rascunho", perms: ["rascunho.use"] },
  { path: "/financeiro", perms: ["finance.overview.view"] },
  { path: "/financeiro/pagar", perms: ["finance.pagar.view"] },
  { path: "/financeiro/receber", perms: ["finance.receber.view"] },
  { path: "/financeiro/fluxo", perms: ["finance.cashflow.view"] },
  { path: "/financeiro/bancos", perms: ["finance.banks.view", "finance.cards.view"] },
  { path: "/financeiro/dre", perms: ["finance.dre.view"] },
  { path: "/financeiro/historico", perms: ["finance.history.view"] },
  { path: "/financeiro/configuracoes", perms: Object.values(FIN_SETTINGS_PERMS).flat() },
];

// Primeira tela que o usuário pode abrir (destino após login / acesso negado).
export function firstAllowedPath(user) {
  const { canAny } = makeCan(user);
  const hit = ROUTE_PERMS.find((r) => canAny(r.perms));
  return hit ? hit.path : "/configuracoes";
}
