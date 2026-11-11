"""Usuários internos + permissões granulares (autorização central do Vorcel).

CONTA x USUÁRIO
- A conta é o usuário PRINCIPAL já existente (owner). Os dados continuam com
  `owner_id = id do principal` — nada foi migrado.
- Usuário interno = documento em `users` com `user_type="internal"` e
  `account_owner_id` apontando para o principal. Ele NUNCA é dono de dados.
- `get_current_user` (auth.py) devolve o "principal efetivo": `id` é SEMPRE o
  dono da conta (todas as consultas existentes por owner_id continuam valendo),
  e `actor_*` identifica quem está agindo (auditoria / created_by).

AUTORIZAÇÃO
- Deny by default: rota sem regra nesta tabela é NEGADA para usuário interno.
- O principal (owner) tem acesso total; usuário interno só o que estiver em
  `permissions` (lido do banco a cada requisição — nada é confiado ao JWT).
- A checagem roda como dependência de TODOS os routers (`enforce`), antes do
  handler. Regras que dependem do corpo/do registro são funções async.
- Gerenciar usuários é EXCLUSIVO do principal (não existe permissão concedível)."""
from typing import Awaitable, Callable, Dict, Iterable, Optional, Tuple, Union

from fastapi import HTTPException, Request
from starlette.requests import HTTPConnection

from db import db

# ============================================================== catálogo
# Cada ação: (permission_key, label). `critical=True` só muda o destaque na tela.
# A ordem aqui é a ordem da tela de permissões.
CATALOG = [
    {"group": "Geral", "modules": [
        {"id": "analytics", "label": "Análises", "actions": [
            ("analytics.view", "Visualizar análises"),
        ]},
    ]},
    {"group": "Licitações", "modules": [
        {"id": "licitacoes", "label": "Licitações (participações)", "actions": [
            ("licitacoes.view", "Visualizar"),
            ("licitacoes.create", "Criar"),
            ("licitacoes.edit", "Editar dados, favoritos e observações"),
            ("licitacoes.status", "Alterar status"),
            ("licitacoes.delete", "Excluir"),
        ]},
        {"id": "licitacoes.docs", "label": "Edital e anexos", "actions": [
            ("licitacoes.docs.view", "Visualizar / baixar"),
            ("licitacoes.docs.attach", "Anexar"),
            ("licitacoes.docs.delete", "Remover"),
        ]},
        {"id": "propostas", "label": "Propostas", "actions": [
            ("propostas.view", "Visualizar / baixar"),
            ("propostas.attach", "Anexar"),
            ("propostas.edit", "Substituir / sincronizar com o Drive"),
            ("propostas.delete", "Excluir"),
        ]},
        {"id": "orcamento", "label": "Orçamentos", "actions": [
            ("orcamento.view", "Visualizar"),
            ("orcamento.edit", "Editar planilha (linhas, lotes, resumo)"),
        ]},
        {"id": "rascunho", "label": "Rascunho de orçamento", "actions": [
            ("rascunho.use", "Usar o rascunho (planilha pessoal)"),
        ]},
    ]},
    {"group": "Execução & Pós-Venda", "modules": [
        {"id": "execution", "label": "Execução", "actions": [
            ("execution.view", "Visualizar"),
            ("execution.edit", "Editar dados (prazos, atestado, pagamento)"),
            ("execution.status", "Alterar etapa da timeline"),
        ]},
        {"id": "execution.docs", "label": "Documentos (empenho, NF, outros)", "actions": [
            ("execution.docs.view", "Visualizar / baixar"),
            ("execution.docs.attach", "Anexar"),
            ("execution.docs.delete", "Remover"),
        ]},
        {"id": "execution.remessas", "label": "Remessas", "actions": [
            ("execution.remessas.create", "Criar"),
            ("execution.remessas.edit", "Editar"),
            ("execution.remessas.delete", "Excluir"),
        ]},
        {"id": "execution.recebiveis", "label": "Recebíveis", "actions": [
            ("execution.recebiveis.send", "Enviar / retirar recebível para o Financeiro"),
        ]},
    ]},
    {"group": "Financeiro", "modules": [
        {"id": "finance.overview", "label": "Visão Geral", "actions": [
            ("finance.overview.view", "Visualizar"),
        ]},
        {"id": "finance.pagar", "label": "A Pagar", "actions": [
            ("finance.pagar.view", "Visualizar"),
            ("finance.pagar.create", "Criar lançamento"),
            ("finance.pagar.edit", "Editar lançamento"),
            ("finance.pagar.cancel", "Cancelar / reativar lançamento"),
            ("finance.pagar.delete", "Excluir lançamento"),
            ("finance.pagar.settle", "Registrar pagamento"),
            ("finance.pagar.reverse", "Estornar pagamento"),
        ]},
        {"id": "finance.receber", "label": "A Receber", "actions": [
            ("finance.receber.view", "Visualizar"),
            ("finance.receber.create", "Criar lançamento"),
            ("finance.receber.edit", "Editar lançamento"),
            ("finance.receber.cancel", "Cancelar / reativar lançamento"),
            ("finance.receber.delete", "Excluir lançamento"),
            ("finance.receber.settle", "Registrar recebimento"),
            ("finance.receber.reverse", "Estornar recebimento"),
            ("finance.receber.approve", "Aprovar recebível vindo da Execução"),
            ("finance.receber.reject", "Rejeitar recebível vindo da Execução"),
        ]},
        {"id": "finance.cashflow", "label": "Fluxo de Caixa", "actions": [
            ("finance.cashflow.view", "Visualizar"),
        ]},
        {"id": "finance.banks", "label": "Bancos", "actions": [
            ("finance.banks.view", "Visualizar contas, saldos e movimentações"),
            ("finance.banks.create", "Criar conta bancária"),
            ("finance.banks.edit", "Editar conta bancária"),
            ("finance.banks.balance", "Ajustar saldo"),
            ("finance.banks.inactivate", "Inativar / reativar conta"),
            ("finance.banks.delete", "Excluir conta (só se nunca usada)"),
        ]},
        {"id": "finance.cards", "label": "Cartões", "actions": [
            ("finance.cards.view", "Visualizar"),
            ("finance.cards.create", "Criar"),
            ("finance.cards.edit", "Editar"),
            ("finance.cards.inactivate", "Inativar / reativar"),
            ("finance.cards.delete", "Excluir (só se nunca usado)"),
        ]},
        {"id": "finance.dre", "label": "DRE", "actions": [
            ("finance.dre.view", "Visualizar DRE"),
            ("finance.dre.configure", "Configurar estrutura da DRE"),
        ]},
        {"id": "finance.history", "label": "Histórico", "actions": [
            ("finance.history.view", "Visualizar histórico / auditoria"),
        ]},
    ]},
    {"group": "Cadastros", "modules": [
        {"id": "finance.contacts", "label": "Clientes e fornecedores", "actions": [
            ("finance.contacts.view", "Visualizar"),
            ("finance.contacts.create", "Criar"),
            ("finance.contacts.edit", "Editar / inativar"),
            ("finance.contacts.delete", "Excluir (só se nunca usado)"),
        ]},
        {"id": "finance.categories", "label": "Categorias e subcategorias", "actions": [
            ("finance.categories.view", "Visualizar"),
            ("finance.categories.create", "Criar"),
            ("finance.categories.edit", "Editar"),
            ("finance.categories.inactivate", "Inativar / reativar"),
            ("finance.categories.delete", "Excluir (só se nunca usada)"),
        ]},
        {"id": "finance.tags", "label": "Tags", "actions": [
            ("finance.tags.view", "Visualizar"),
            ("finance.tags.create", "Criar"),
            ("finance.tags.edit", "Editar"),
            ("finance.tags.inactivate", "Inativar / reativar"),
            ("finance.tags.delete", "Excluir (só se nunca usada)"),
        ]},
        {"id": "finance.forms", "label": "Formas de pagamento", "actions": [
            ("finance.forms.view", "Visualizar"),
            ("finance.forms.create", "Criar"),
            ("finance.forms.edit", "Editar"),
            ("finance.forms.inactivate", "Inativar / reativar"),
            ("finance.forms.delete", "Excluir (só se nunca usada)"),
        ]},
    ]},
    {"group": "Configurações", "modules": [
        {"id": "config", "label": "Configurações gerais", "actions": [
            ("config.lists.edit", "Gerenciar listas (modalidades, portais, status)"),
            ("config.company.edit", "Editar dados da empresa"),
            ("config.preferences.edit", "Alterar padrões (impostos, margem) e preferências do Financeiro"),
            ("config.google.manage", "Conectar / desconectar Google Drive"),
        ]},
    ]},
]

ALL_KEYS = frozenset(k for g in CATALOG for m in g["modules"] for k, _ in m["actions"])

# Dependências: conceder a ação concede também a(s) permissão(ões) de leitura
# necessárias para a tela fazer sentido. NUNCA concede outra ação sensível.
_VIEW_OF_MODULE = {}
for _g in CATALOG:
    for _m in _g["modules"]:
        _views = [k for k, _ in _m["actions"] if k.endswith(".view")]
        for _k, _ in _m["actions"]:
            if _views and _k not in _views:
                _VIEW_OF_MODULE[_k] = _views[0]
_EXTRA_IMPLIES = {
    "licitacoes.docs.view": ["licitacoes.view"],
    "propostas.view": ["licitacoes.view"],
    "orcamento.view": ["licitacoes.view"],
    "execution.docs.view": ["execution.view"],
    "execution.remessas.create": ["execution.view"],
    "execution.remessas.edit": ["execution.view"],
    "execution.remessas.delete": ["execution.view"],
    "execution.recebiveis.send": ["execution.view"],
    "finance.receber.approve": ["finance.receber.view"],
    "finance.receber.reject": ["finance.receber.view"],
}


def normalize_permissions(keys: Iterable[str]) -> list:
    """Valida contra o catálogo oficial e acrescenta as leituras implícitas.
    Chave desconhecida => 400 (nunca vira acesso)."""
    keys = list(dict.fromkeys(keys or []))
    unknown = [k for k in keys if k not in ALL_KEYS]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Permissão desconhecida: {', '.join(unknown[:5])}")
    out = set(keys)
    changed = True
    while changed:
        changed = False
        for k in list(out):
            for dep in [_VIEW_OF_MODULE.get(k), *_EXTRA_IMPLIES.get(k, [])]:
                if dep and dep not in out:
                    out.add(dep)
                    changed = True
    return sorted(out)


# ============================================================== checagem
def has(current: dict, key: str) -> bool:
    if current.get("is_owner"):
        return True
    return key in ALL_KEYS and key in (current.get("permissions") or ())


def has_any(current: dict, keys: Iterable[str]) -> bool:
    return any(has(current, k) for k in keys)


def forbid(msg: str = "Você não tem permissão para esta ação.") -> HTTPException:
    return HTTPException(status_code=403, detail={"code": "forbidden", "msg": msg})


def require(current: dict, *keys: str) -> None:
    """Exige TODAS as chaves."""
    for k in keys:
        if not has(current, k):
            raise forbid()


def require_any(current: dict, *keys: str) -> None:
    if not has_any(current, keys):
        raise forbid()


# Atalhos de domínio usados em mais de um módulo ---------------------------------
FIN_TYPES = {"pagar": "finance.pagar", "receber": "finance.receber"}
# Quem lança/baixa precisa dos cadastros (categorias, formas, contas, tags) para preencher o formulário.
FIN_FORM_KEYS = tuple(f"finance.{t}.{a}" for t in ("pagar", "receber") for a in ("create", "edit", "settle"))
FIN_ANY = tuple(k for k in ALL_KEYS if k.startswith("finance."))
CADASTRO_PREFIX = {
    "categoria": "finance.categories", "subcategoria": "finance.categories", "forma": "finance.forms",
    "conta": "finance.banks", "cartao": "finance.cards", "tag": "finance.tags", "dre_grupo": "finance.dre",
}


def fin_type_key(tipo: str, action: str) -> str:
    base = FIN_TYPES.get(tipo)
    if not base:
        raise HTTPException(status_code=400, detail="Tipo deve ser A Pagar ou A Receber.")
    return f"{base}.{action}"


def allowed_fin_types(current: dict) -> list:
    return [t for t, base in FIN_TYPES.items() if has(current, f"{base}.view")]


def cadastro_key(kind: str, action: str) -> str:
    prefix = CADASTRO_PREFIX.get(kind)
    if not prefix:
        raise HTTPException(status_code=404, detail="Cadastro inválido")
    if prefix == "finance.dre":   # grupos da DRE: qualquer alteração = configurar a DRE
        return "finance.dre.view" if action == "view" else "finance.dre.configure"
    return f"{prefix}.{action}"


# ============================================================== tabela de rotas
PUBLIC = "public"         # sem autenticação (login, callback OAuth)
AUTHED = "authed"         # qualquer membro ativo da conta
SELF_CHECK = "self"       # handler autentica pelo token da URL e checa a permissão
OWNER_ONLY = "owner"      # exclusivo do usuário principal

Rule = Union[str, Tuple[str, ...], Callable[[dict, Request], Awaitable[None]]]


async def _json(request: Request) -> dict:
    try:
        data = await request.json()
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


# ---- regras dependentes do corpo / do registro ----
async def _bid_put(cur: dict, req: Request) -> None:
    from bson import ObjectId
    require(cur, "licitacoes.edit")
    body = await _json(req)
    try:
        bid = await db.bids.find_one({"_id": ObjectId(req.path_params["bid_id"]), "owner_id": cur["id"]},
                                     {"status": 1, "termo_referencia": 1, "anexos": 1})
    except Exception:
        bid = None
    if not bid:
        return  # o handler devolve 404
    if "status" in body and body.get("status") != bid.get("status"):
        require(cur, "licitacoes.status")

    def ids(tr, anexos):
        return {x.get("id") for x in ([tr] if tr else []) + list(anexos or []) if isinstance(x, dict)}

    before = ids(bid.get("termo_referencia"), bid.get("anexos"))
    after = ids(body.get("termo_referencia"), body.get("anexos"))
    if after - before:
        require(cur, "licitacoes.docs.attach")
    if before - after:
        require(cur, "licitacoes.docs.delete")


async def _bid_create(cur: dict, req: Request) -> None:
    require(cur, "licitacoes.create")
    body = await _json(req)
    if body.get("termo_referencia") or body.get("anexos"):
        require(cur, "licitacoes.docs.attach")
    # Já nascer com outro status (ex.: "Adicionar licitação ganha" = Adjudicado) é trocar status.
    if body.get("status") not in (None, "", "Disputar"):
        require(cur, "licitacoes.status")


_EXEC_STATUS_FIELDS = {"status_atual", "current_step", "timeline"}


async def _execution_put(cur: dict, req: Request) -> None:
    body = await _json(req)
    fields = {k for k, v in body.items() if v is not None}
    if fields & _EXEC_STATUS_FIELDS:
        require(cur, "execution.status")
    if fields - _EXEC_STATUS_FIELDS:
        require(cur, "execution.edit")
    if not fields:
        require(cur, "execution.edit")


async def _remessa_put(cur: dict, req: Request) -> None:
    body = await _json(req)
    fields = {k for k, v in body.items() if v is not None}
    if fields & _EXEC_STATUS_FIELDS:
        require(cur, "execution.status")
    if fields - _EXEC_STATUS_FIELDS:
        require(cur, "execution.remessas.edit")


async def _entry_create(cur: dict, req: Request) -> None:
    body = await _json(req)
    require(cur, fin_type_key(body.get("type"), "create"))


def _entry_action(action: str):
    async def rule(cur: dict, req: Request) -> None:
        e = await db.fin_entries.find_one({"owner_id": cur["id"], "id": req.path_params.get("entry_id")}, {"type": 1})
        if not e:
            return  # handler: 404
        require(cur, fin_type_key(e["type"], action))
    return rule


async def _entries_list(cur: dict, req: Request) -> None:
    tipo = req.query_params.get("type")
    if tipo:
        require(cur, fin_type_key(tipo, "view"))
    elif not allowed_fin_types(cur) and not has(cur, "finance.overview.view"):
        raise forbid()


async def _resumo(cur: dict, req: Request) -> None:
    require(cur, fin_type_key(req.query_params.get("type"), "view"))


async def _cadastro_create(cur: dict, req: Request) -> None:
    require(cur, cadastro_key(req.path_params.get("kind"), "create"))


async def _cadastro_update(cur: dict, req: Request) -> None:
    kind = req.path_params.get("kind")
    body = await _json(req)
    if "ativo" in body:
        require(cur, cadastro_key(kind, "inactivate") if CADASTRO_PREFIX.get(kind) != "finance.dre"
                else "finance.dre.configure")
    if any(k != "ativo" for k in body):
        require(cur, cadastro_key(kind, "edit"))
    if not body:
        require(cur, cadastro_key(kind, "edit"))


async def _cadastro_delete(cur: dict, req: Request) -> None:
    require(cur, cadastro_key(req.path_params.get("kind"), "delete"))


async def _cadastros_list(cur: dict, req: Request) -> None:
    # Filtragem fina por tipo (e saldos) é feita no handler.
    require_any(cur, *FIN_ANY)


async def _contacts_read(cur: dict, req: Request) -> None:
    require_any(cur, "finance.contacts.view", *FIN_FORM_KEYS)


async def _upload(cur: dict, req: Request) -> None:
    # Subir arquivo para o R2 só para quem pode ANEXAR/alterar algo (o vínculo do
    # arquivo a um registro é checado de novo na rota que o anexa).
    if cur.get("is_owner"):
        return
    if not any(not k.endswith(".view") for k in (cur.get("permissions") or ()) if k in ALL_KEYS):
        raise forbid()


# UX pessoal (ordenação, paginação, grupos abertos, tema): qualquer membro;
# gravado por usuário. O resto das preferências (impostos, margem, Financeiro) exige permissão.
UX_PREF_KEYS = {"theme", "table_sorts", "table_page_sizes", "execution_groups"}


async def _prefs_put(cur: dict, req: Request) -> None:
    body = await _json(req)
    if any(k not in UX_PREF_KEYS for k, v in body.items() if v is not None):
        require(cur, "config.preferences.edit")


def _ex(*keys: str):
    """Exige TODAS as chaves."""
    async def rule(cur: dict, req: Request) -> None:
        require(cur, *keys)
    return rule


RULES: Dict[Tuple[str, str], Rule] = {
    # ---------------- auth
    ("POST", "/api/auth/register"): PUBLIC,
    ("POST", "/api/auth/login"): PUBLIC,
    ("GET", "/api/auth/me"): AUTHED,
    ("PUT", "/api/auth/profile"): AUTHED,
    ("POST", "/api/auth/change-password"): AUTHED,
    ("POST", "/api/auth/logout"): AUTHED,
    # ---------------- usuários (exclusivo do principal)
    ("GET", "/api/users/permissions-catalog"): OWNER_ONLY,
    ("GET", "/api/users"): OWNER_ONLY,
    ("POST", "/api/users"): OWNER_ONLY,
    ("PUT", "/api/users/{user_id}"): OWNER_ONLY,
    ("POST", "/api/users/{user_id}/reset-password"): OWNER_ONLY,
    ("POST", "/api/users/{user_id}/revoke-sessions"): OWNER_ONLY,
    # ---------------- arquivos (R2)
    ("POST", "/api/upload"): _upload,
    ("GET", "/api/files/{file_id}"): SELF_CHECK,
    # ---------------- listas / empresa / preferências / rascunho
    ("GET", "/api/lists"): AUTHED,
    ("POST", "/api/lists/{list_type}"): "config.lists.edit",
    ("PUT", "/api/lists/{list_type}"): "config.lists.edit",
    ("PUT", "/api/lists/{list_type}/reorder"): "config.lists.edit",
    ("DELETE", "/api/lists/{list_type}/{value}"): "config.lists.edit",
    ("GET", "/api/company"): AUTHED,
    ("PUT", "/api/company"): "config.company.edit",
    ("GET", "/api/preferences"): AUTHED,
    ("PUT", "/api/preferences"): _prefs_put,
    ("GET", "/api/draft/budget"): "rascunho.use",
    ("PUT", "/api/draft/budget"): "rascunho.use",
    ("POST", "/api/draft/budget/reset"): "rascunho.use",
    # ---------------- licitações
    ("GET", "/api/bids"): "licitacoes.view",
    ("POST", "/api/bids"): _bid_create,
    ("GET", "/api/bids/{bid_id}"): "licitacoes.view",
    ("PUT", "/api/bids/{bid_id}"): _bid_put,
    ("PATCH", "/api/bids/{bid_id}/status"): "licitacoes.status",
    ("PATCH", "/api/bids/{bid_id}/favorite"): "licitacoes.edit",
    ("PATCH", "/api/bids/{bid_id}/observacoes"): "licitacoes.edit",
    ("PATCH", "/api/bids/{bid_id}/proposta"): "propostas.edit",
    ("POST", "/api/bids/{bid_id}/anexos"): "licitacoes.docs.attach",
    ("DELETE", "/api/bids/{bid_id}/anexos/{file_id}"): "licitacoes.docs.delete",
    ("DELETE", "/api/bids/{bid_id}"): "licitacoes.delete",
    ("GET", "/api/dashboard/summary"): "licitacoes.view",
    # ---------------- propostas
    ("POST", "/api/bids/{bid_id}/proposta"): "propostas.attach",
    ("PUT", "/api/bids/{bid_id}/proposta"): "propostas.edit",
    ("DELETE", "/api/bids/{bid_id}/proposta"): "propostas.delete",
    ("POST", "/api/bids/{bid_id}/proposta/sync"): "propostas.edit",
    ("GET", "/api/bids/{bid_id}/proposta/status"): "propostas.view",
    ("GET", "/api/bids/{bid_id}/proposta/preview.pdf"): SELF_CHECK,
    ("GET", "/api/bids/{bid_id}/proposta/download"): SELF_CHECK,
    # ---------------- orçamento (original e por remessa)
    ("GET", "/api/bids/{bid_id}/budget"): "orcamento.view",
    ("PATCH", "/api/bids/{bid_id}/budget/rows/{row_id}"): "orcamento.edit",
    ("POST", "/api/bids/{bid_id}/budget/rows"): "orcamento.edit",
    ("DELETE", "/api/bids/{bid_id}/budget/rows/{row_id}"): "orcamento.edit",
    ("PUT", "/api/bids/{bid_id}/budget/order"): "orcamento.edit",
    ("PUT", "/api/bids/{bid_id}/budget/summary"): "orcamento.edit",
    ("PUT", "/api/bids/{bid_id}/budget"): "orcamento.edit",
    ("GET", "/api/bids/{bid_id}/remessas/{remessa_id}/budget"): "orcamento.view",
    ("PATCH", "/api/bids/{bid_id}/remessas/{remessa_id}/budget/rows/{row_id}"): "orcamento.edit",
    ("POST", "/api/bids/{bid_id}/remessas/{remessa_id}/budget/rows"): "orcamento.edit",
    ("DELETE", "/api/bids/{bid_id}/remessas/{remessa_id}/budget/rows/{row_id}"): "orcamento.edit",
    ("PUT", "/api/bids/{bid_id}/remessas/{remessa_id}/budget/order"): "orcamento.edit",
    ("PUT", "/api/bids/{bid_id}/remessas/{remessa_id}/budget/summary"): "orcamento.edit",
    # ---------------- execução
    ("GET", "/api/executions"): "execution.view",
    ("GET", "/api/executions/kpis"): "execution.view",
    ("GET", "/api/executions/{bid_id}"): "execution.view",
    ("PUT", "/api/executions/{bid_id}"): _execution_put,
    ("POST", "/api/executions/{bid_id}/timeline/{step}/file"): "execution.docs.attach",
    ("DELETE", "/api/executions/{bid_id}/timeline/{step}/file/{file_id}"): "execution.docs.delete",
    ("POST", "/api/executions/{bid_id}/documentos/{categoria}"): "execution.docs.attach",
    ("DELETE", "/api/executions/{bid_id}/documentos/{categoria}/{file_id}"): "execution.docs.delete",
    ("POST", "/api/executions/{bid_id}/remessas"): "execution.remessas.create",
    ("PUT", "/api/executions/{bid_id}/remessas/{remessa_id}"): _remessa_put,
    ("POST", "/api/executions/{bid_id}/remessas/{remessa_id}/documentos/{categoria}"): "execution.docs.attach",
    ("DELETE", "/api/executions/{bid_id}/remessas/{remessa_id}/documentos/{categoria}/{file_id}"): "execution.docs.delete",
    ("DELETE", "/api/executions/{bid_id}/remessas/{remessa_id}"): "execution.remessas.delete",
    # ---------------- análises
    ("GET", "/api/analytics"): "analytics.view",
    # ---------------- Google Drive
    ("GET", "/api/integrations/google/status"): AUTHED,
    ("GET", "/api/integrations/google/auth-url"): "config.google.manage",
    ("GET", "/api/integrations/google/callback"): PUBLIC,   # valida o `state` assinado
    ("POST", "/api/integrations/google/folder"): "config.google.manage",
    ("POST", "/api/integrations/google/disconnect"): "config.google.manage",
    # ---------------- financeiro: cadastros
    ("GET", "/api/fin/cadastros"): _cadastros_list,
    ("POST", "/api/fin/cadastros/{kind}"): _cadastro_create,
    ("PUT", "/api/fin/cadastros/{kind}/{item_id}"): _cadastro_update,
    ("DELETE", "/api/fin/cadastros/{kind}/{item_id}"): _cadastro_delete,
    ("POST", "/api/fin/contas/{conta_id}/saldo"): "finance.banks.balance",
    ("GET", "/api/fin/descricoes-recentes"): FIN_FORM_KEYS,
    # ---------------- financeiro: lançamentos e baixas
    ("POST", "/api/fin/lancamentos"): _entry_create,
    ("GET", "/api/fin/lancamentos"): _entries_list,
    ("GET", "/api/fin/lancamentos/{entry_id}"): _entry_action("view"),
    ("PUT", "/api/fin/lancamentos/{entry_id}"): _entry_action("edit"),
    ("POST", "/api/fin/lancamentos/{entry_id}/baixar"): _entry_action("settle"),
    ("GET", "/api/fin/lancamentos/{entry_id}/baixas"): _entry_action("view"),
    ("POST", "/api/fin/lancamentos/{entry_id}/baixas/{settlement_id}/estornar"): _entry_action("reverse"),
    ("POST", "/api/fin/lancamentos/{entry_id}/reabrir"): _entry_action("cancel"),
    ("POST", "/api/fin/lancamentos/{entry_id}/cancelar"): _entry_action("cancel"),
    ("DELETE", "/api/fin/lancamentos/{entry_id}"): _entry_action("delete"),
    ("GET", "/api/fin/movimentos"): "finance.banks.view",
    ("GET", "/api/fin/visao-geral"): "finance.overview.view",
    ("GET", "/api/fin/resumo"): _resumo,
    ("GET", "/api/fin/fluxo"): "finance.cashflow.view",
    ("GET", "/api/fin/historico"): "finance.history.view",
    # ---------------- financeiro: DRE
    ("GET", "/api/fin/dre"): "finance.dre.view",
    ("GET", "/api/fin/dre/lancamentos"): "finance.dre.view",
    ("POST", "/api/fin/dre/classificar-pendentes"): "finance.dre.configure",
    ("PUT", "/api/fin/dre/titulos"): "finance.dre.configure",
    ("GET", "/api/fin/dre/titulos"): "finance.dre.view",
    # ---------------- financeiro: recebíveis da Execução
    ("POST", "/api/fin/recebiveis/solicitacoes"): "execution.recebiveis.send",
    ("POST", "/api/fin/recebiveis/solicitacoes/{request_id}/retirar"): "execution.recebiveis.send",
    ("GET", "/api/fin/recebiveis/vinculos"): ("execution.view", "finance.receber.view"),
    ("GET", "/api/fin/recebiveis/solicitacoes"): ("finance.receber.view", "finance.overview.view"),
    ("POST", "/api/fin/recebiveis/solicitacoes/{request_id}/aprovar"): "finance.receber.approve",
    ("POST", "/api/fin/recebiveis/solicitacoes/{request_id}/rejeitar"): "finance.receber.reject",
    ("GET", "/api/fin/recebiveis/atualizacoes"): ("finance.receber.view", "finance.overview.view"),
    ("POST", "/api/fin/recebiveis/atualizacoes/{request_id}"): "finance.receber.approve",
    ("POST", "/api/fin/recebiveis/sincronizar-execucao"): "execution.status",
    # ---------------- financeiro: clientes / fornecedores
    ("GET", "/api/fin/contatos"): _contacts_read,
    ("GET", "/api/fin/contatos/sugestao"): _contacts_read,
    ("GET", "/api/fin/contatos/{contact_id}"): _contacts_read,
    ("POST", "/api/fin/contatos"): "finance.contacts.create",
    ("PUT", "/api/fin/contatos/{contact_id}"): "finance.contacts.edit",
    ("DELETE", "/api/fin/contatos/{contact_id}"): "finance.contacts.delete",
}


async def enforce(request: HTTPConnection) -> None:
    """Dependência global de autorização (todos os routers).
    WebSocket faz a própria checagem (budget_sync._ws_session)."""
    if request.scope.get("type") != "http":
        return
    route = request.scope.get("route")
    path = getattr(route, "path", None)
    rule = RULES.get((request.method, path)) if path else None
    if rule in (PUBLIC, SELF_CHECK):
        return
    from auth import get_current_user
    current = await get_current_user(request)
    if current.get("is_owner"):
        return
    if rule is None or rule == OWNER_ONLY:
        # Deny by default: rota nova sem regra explícita não abre para usuário interno.
        raise forbid("Acesso restrito ao administrador da conta." if rule == OWNER_ONLY else
                     "Você não tem permissão para esta ação.")
    if rule == AUTHED:
        return
    if isinstance(rule, str):
        require(current, rule)
    elif isinstance(rule, tuple):
        require_any(current, *rule)
    else:
        await rule(current, request)


def unmapped_routes(app) -> list:
    """Rotas HTTP /api sem regra — usado em teste para garantir cobertura total."""
    out = []
    for r in app.routes:
        methods = getattr(r, "methods", None) or ()
        path = getattr(r, "path", "")
        if not path.startswith("/api"):
            continue
        for m in methods:
            if m in ("HEAD", "OPTIONS"):
                continue
            if (m, path) not in RULES:
                out.append((m, path))
    return out


async def file_permission(current: dict, file_id: str) -> None:
    """Download de arquivo: o arquivo herda a permissão do lugar onde está anexado.
    Edital/anexos => licitacoes.docs.view; proposta => propostas.view;
    documentos/timeline/remessas da Execução => execution.docs.view.
    Arquivos fora desses lugares (logo da empresa, logos de bancos/cartões,
    avatar, upload recém-feito) => qualquer membro da conta."""
    if current.get("is_owner"):
        return
    owner = current["id"]
    needed = []
    if await db.bids.find_one({"owner_id": owner, "$or": [
            {"termo_referencia.id": file_id}, {"anexos.id": file_id}]}, {"_id": 1}):
        needed.append("licitacoes.docs.view")
    if await db.bids.find_one({"owner_id": owner, "$or": [
            {"proposta.file_id": file_id}, {"propostas.file_id": file_id}]}, {"_id": 1}):
        needed.append("propostas.view")
    if await db.executions.find_one({"owner_id": owner, "$or": [
            {"documentos.nota_empenho.id": file_id}, {"documentos.nota_fiscal.id": file_id},
            {"documentos.outros.id": file_id}, {"timeline.files.id": file_id},
            {"remessas.documentos.nota_empenho.id": file_id}, {"remessas.documentos.nota_fiscal.id": file_id},
            {"remessas.documentos.outros.id": file_id}, {"remessas.timeline.files.id": file_id}]}, {"_id": 1}):
        needed.append("execution.docs.view")
    if needed and not has_any(current, needed):
        raise forbid("Você não tem permissão para acessar este documento.")
