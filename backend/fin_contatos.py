"""Clientes e Fornecedores do Financeiro (`fin_contacts`, sempre por `owner_id`).

Um cadastro tem UM papel exclusivo: cliente | fornecedor | ambos. O lançamento
aponta para o cadastro por `contact_id` (o vínculo real) e guarda o nome em
`client_supplier` só como snapshot de apresentação/busca — o mesmo padrão de
categoria/conta. Lançamentos antigos com `client_supplier` em texto livre e sem
`contact_id` continuam válidos (nada é migrado nem criado automaticamente).

Compatibilidade de papel: A Pagar aceita fornecedor|ambos; A Receber aceita
cliente|ambos. Excluir só é permitido sem vínculo; com vínculo, o caminho é inativar."""
import re
import unicodedata
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from pymongo.errors import DuplicateKeyError

from auth import get_current_user
from db import db, now_iso
from fin_core import PAGAR, RECEBER, in_transaction, log_event, new_id

contacts_router = APIRouter(prefix="/api/fin/contatos", tags=["financeiro-contatos"])

ROLES = ("cliente", "fornecedor", "ambos")
PERSON_TYPES = ("pf", "pj")
# Papéis aceitos por tipo de lançamento.
ROLES_FOR_TYPE = {PAGAR: ("fornecedor", "ambos"), RECEBER: ("cliente", "ambos")}
ROLE_LABEL = {"cliente": "Cliente", "fornecedor": "Fornecedor", "ambos": "Cliente e Fornecedor"}
ADDRESS_FIELDS = ("cep", "logradouro", "numero", "complemento", "bairro", "cidade", "uf")
FIELD_LABELS = {
    "person_type": "Pessoa", "name": "Razão Social / Nome", "document": "CPF/CNPJ", "email": "E-mail",
    "phone": "Telefone", "address_text": "Endereço", "notes": "Observações", "role": "Tipo de cadastro",
    "ativo": "Ativo",
}


def normalize(text: str) -> str:
    """minúsculas, sem acentos e espaços repetidos — chave de busca e de sugestão."""
    s = unicodedata.normalize("NFKD", text or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s).strip().lower()


def _digits(text: Optional[str]) -> str:
    return re.sub(r"\D", "", text or "")


def valid_cpf(d: str) -> bool:
    if len(d) != 11 or d == d[0] * 11:
        return False
    for n in (9, 10):
        s = sum(int(d[i]) * (n + 1 - i) for i in range(n))
        if (s * 10 % 11) % 10 != int(d[n]):
            return False
    return True


def valid_cnpj(d: str) -> bool:
    if len(d) != 14 or d == d[0] * 14:
        return False
    for n in (12, 13):
        pesos = list(range(n - 7, 1, -1)) + list(range(9, 1, -1))
        s = sum(int(d[i]) * pesos[i] for i in range(n))
        dv = 11 - s % 11
        if (0 if dv >= 10 else dv) != int(d[n]):
            return False
    return True


def _address_text(addr: Optional[dict]) -> Optional[str]:
    if not addr:
        return None
    a = addr
    rua = ", ".join(p for p in (a.get("logradouro"), a.get("numero")) if p)
    partes = [rua, a.get("complemento"), a.get("bairro"),
              " / ".join(p for p in (a.get("cidade"), a.get("uf")) if p), a.get("cep") and f"CEP {a['cep']}"]
    return " · ".join(p for p in partes if p) or None


def _out(doc: dict, usage: Optional[int] = None) -> dict:
    out = {k: v for k, v in doc.items() if k not in ("_id", "owner_id", "search_key")}
    out.setdefault("address", {})
    if usage is not None:
        out["usage"] = usage
    return out


class AddressInput(BaseModel):
    model_config = {"extra": "ignore"}
    cep: Optional[str] = None
    logradouro: Optional[str] = None
    numero: Optional[str] = None
    complemento: Optional[str] = None
    bairro: Optional[str] = None
    cidade: Optional[str] = None
    uf: Optional[str] = None


class ContactInput(BaseModel):
    model_config = {"extra": "ignore"}
    person_type: Optional[str] = None
    name: Optional[str] = None
    document: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[AddressInput] = None
    notes: Optional[str] = None
    role: Optional[str] = None
    ativo: Optional[bool] = None


def _validated(body: ContactInput, creating: bool, current_doc: Optional[dict] = None) -> dict:
    sent = body.model_fields_set
    data: dict = {}
    for f in ("person_type", "name", "document", "email", "phone", "notes", "role", "ativo"):
        if f in sent:
            v = getattr(body, f)
            data[f] = (v.strip() or None) if isinstance(v, str) else v
    if creating or "name" in data:
        if not data.get("name"):
            raise HTTPException(status_code=400, detail="Informe a Razão Social / Nome.")
    if creating or "person_type" in data:
        if data.get("person_type") not in PERSON_TYPES:
            raise HTTPException(status_code=400, detail="Escolha Pessoa Física ou Pessoa Jurídica.")
    if creating or "role" in data:
        if data.get("role") not in ROLES:
            raise HTTPException(status_code=400, detail="Escolha o tipo de cadastro: Cliente, Fornecedor ou Cliente e Fornecedor.")
    pt = data.get("person_type") or (current_doc or {}).get("person_type")
    if "document" in data or ("person_type" in data and current_doc):
        doc_digits = _digits(data["document"]) if "document" in data else (current_doc or {}).get("document")
        if doc_digits:
            if pt == "pf" and not valid_cpf(doc_digits):
                raise HTTPException(status_code=400, detail="CPF inválido.")
            if pt == "pj" and not valid_cnpj(doc_digits):
                raise HTTPException(status_code=400, detail="CNPJ inválido.")
        data["document"] = doc_digits or None
    if data.get("email") and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", data["email"]):
        raise HTTPException(status_code=400, detail="E-mail inválido.")
    if "address" in sent:
        addr = {k: (getattr(body.address, k) or "").strip() or None for k in ADDRESS_FIELDS} if body.address else {}
        if addr.get("cep"):
            cep = _digits(addr["cep"])
            if len(cep) != 8:
                raise HTTPException(status_code=400, detail="CEP deve ter 8 dígitos.")
            addr["cep"] = f"{cep[:5]}-{cep[5:]}"
        if addr.get("uf"):
            addr["uf"] = addr["uf"].upper()[:2]
        data["address"] = {k: v for k, v in addr.items() if v}
    return data


def _search_key(doc: dict) -> str:
    return normalize(" ".join(p for p in (doc.get("name"), doc.get("email")) if p))


async def contact_usage(owner: str, contact_id: str) -> int:
    n = await db.fin_entries.count_documents({"owner_id": owner, "contact_id": contact_id})
    n += await db.fin_requests.count_documents({"owner_id": owner, "contact_id": contact_id})
    return n


async def resolve_contact(owner: str, tipo: str, contact_id: Optional[str], current_id: Optional[str] = None) -> dict:
    """Vínculo do lançamento: valida dono, papel e situação; devolve o par
    {contact_id, client_supplier} (nome atual como snapshot). Um cadastro
    inativo só é aceito se já era o do lançamento (edição de registro antigo)."""
    if not contact_id:
        return {"contact_id": None, "client_supplier": None}
    c = await db.fin_contacts.find_one({"owner_id": owner, "id": contact_id})
    if not c:
        raise HTTPException(status_code=400, detail="Cliente/Fornecedor não encontrado.")
    papel = "Fornecedor" if tipo == PAGAR else "Cliente"
    if c.get("role") not in ROLES_FOR_TYPE[tipo]:
        raise HTTPException(status_code=400, detail=f"\"{c['name']}\" não está cadastrado como {papel.lower()}.")
    if not c.get("ativo", True) and contact_id != current_id:
        raise HTTPException(status_code=400, detail=f"{papel} \"{c['name']}\" está inativo.")
    return {"contact_id": c["id"], "client_supplier": c["name"]}


@contacts_router.get("")
async def list_contacts(q: Optional[str] = None, role: Optional[str] = None, type: Optional[str] = None,
                        include_inactive: bool = False, ids: Optional[str] = None,
                        page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=200),
                        current=Depends(get_current_user)):
    """Listagem (Configurações) e autocomplete (lançamento). `type`=pagar|receber
    filtra pelos papéis compatíveis; `role` filtra exatamente pelo papel."""
    owner = current["id"]
    query: dict = {"owner_id": owner}
    if ids:
        query["id"] = {"$in": [i for i in ids.split(",") if i][:200]}
    else:
        if not include_inactive:
            query["ativo"] = {"$ne": False}
        if type in ROLES_FOR_TYPE:
            query["role"] = {"$in": list(ROLES_FOR_TYPE[type])}
        elif role in ROLES:
            query["role"] = role
        term = (q or "").strip()
        if term:
            conds = [{"search_key": {"$regex": re.escape(normalize(term))}}]
            if len(_digits(term)) >= 3:
                conds.append({"document": {"$regex": re.escape(_digits(term))}})
            query["$or"] = conds
    total = await db.fin_contacts.count_documents(query)
    docs = await db.fin_contacts.find(query).sort([("search_key", 1)]).skip((page - 1) * page_size).limit(page_size).to_list(page_size)
    return {"items": [_out(d) for d in docs], "total": total, "page": page, "page_size": page_size}


@contacts_router.get("/sugestao")
async def suggest_contact(nome: str, type: str = RECEBER, current=Depends(get_current_user)):
    """Sugestão para a aprovação de recebível: SÓ quando existe exatamente um
    cadastro ativo e compatível cujo nome normalizado é IGUAL ao informado.
    Nunca grava nada — o usuário confirma (ou troca) antes de aprovar."""
    owner = current["id"]
    key = normalize(nome)
    if not key or type not in ROLES_FOR_TYPE:
        return {"item": None}
    docs = await db.fin_contacts.find({"owner_id": owner, "ativo": {"$ne": False},
                                       "role": {"$in": list(ROLES_FOR_TYPE[type])}}).to_list(5000)
    hits = [d for d in docs if normalize(d.get("name", "")) == key]
    return {"item": _out(hits[0]) if len(hits) == 1 else None}


@contacts_router.get("/{contact_id}")
async def get_contact(contact_id: str, current=Depends(get_current_user)):
    owner = current["id"]
    doc = await db.fin_contacts.find_one({"owner_id": owner, "id": contact_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Cadastro não encontrado")
    return _out(doc, await contact_usage(owner, contact_id))


def _created_action(role: str) -> str:
    return {"cliente": "cliente_criado", "fornecedor": "fornecedor_criado"}.get(role, "cliente_fornecedor_criado")


def _dup_error():
    return HTTPException(status_code=409, detail={
        "code": "duplicate_document",
        "msg": "Já existe um cadastro com este CPF/CNPJ. Para usar o mesmo cadastro em A Pagar e A Receber, "
               "escolha o tipo \"Cliente e Fornecedor\"."})


@contacts_router.post("")
async def create_contact(body: ContactInput, current=Depends(get_current_user)):
    owner = current["id"]
    data = _validated(body, creating=True)
    ts = now_iso()
    doc = {"id": new_id(), "owner_id": owner, "ativo": True, "email": None, "phone": None, "notes": None,
           "address": {}, **data, "created_by": current.get("actor_id") or current["id"], "created_by_name": current.get("actor_name") or current.get("name"),
           "created_at": ts, "updated_at": ts}
    doc["search_key"] = _search_key(doc)

    async def tx(s):
        await db.fin_contacts.insert_one(doc, session=s)
        await log_event(current, _created_action(doc["role"]), module="config", entity_type="contato",
                        entity_id=doc["id"], entity_label=doc["name"],
                        metadata={"role": doc["role"], "person_type": doc["person_type"], "document": doc.get("document")},
                        session=s)
    try:
        await in_transaction(tx)
    except DuplicateKeyError:
        raise _dup_error()
    return _out(doc, 0)


@contacts_router.put("/{contact_id}")
async def update_contact(contact_id: str, body: ContactInput, current=Depends(get_current_user)):
    owner = current["id"]
    before = await db.fin_contacts.find_one({"owner_id": owner, "id": contact_id})
    if not before:
        raise HTTPException(status_code=404, detail="Cadastro não encontrado")
    data = _validated(body, creating=False, current_doc=before)
    after = {**before, **data}
    # Papel não pode deixar de cobrir lançamentos já vinculados (ex.: virar só
    # Cliente tendo contas A Pagar ligadas a ele).
    if "role" in data and data["role"] != before.get("role"):
        for tipo, roles in ROLES_FOR_TYPE.items():
            if data["role"] not in roles and await db.fin_entries.count_documents(
                    {"owner_id": owner, "contact_id": contact_id, "type": tipo}):
                papel = "fornecedor" if tipo == PAGAR else "cliente"
                raise HTTPException(status_code=400, detail=(
                    f"Este cadastro já está vinculado a lançamentos {'A Pagar' if tipo == PAGAR else 'A Receber'}. "
                    f"Mantenha-o como {papel} ou como \"Cliente e Fornecedor\"."))
    b_view = {**before, "address_text": _address_text(before.get("address")), "role": ROLE_LABEL.get(before.get("role"))}
    a_view = {**after, "address_text": _address_text(after.get("address")), "role": ROLE_LABEL.get(after.get("role"))}
    changes = []
    for field, label in FIELD_LABELS.items():
        if field == "address_text" and "address" not in data:
            continue
        if field != "address_text" and field not in data:
            continue
        b, a = b_view.get(field), a_view.get(field)
        if (b if b is not None else None) != (a if a is not None else None) and (b or a) is not None:
            changes.append({"field": f"contato_{field}", "label": label, "before": b, "after": a})
    if not changes:
        return _out(before)
    action = "contato_inativado" if data.get("ativo") is False and before.get("ativo", True) else (
        "contato_reativado" if data.get("ativo") is True and before.get("ativo") is False else "contato_editado")
    ts = now_iso()
    patch = {**data, "updated_at": ts, "updated_by": current["id"]}
    patch["search_key"] = _search_key(after)

    async def tx(s):
        await db.fin_contacts.update_one({"_id": before["_id"]}, {"$set": patch}, session=s)
        if "name" in data and data["name"] != before.get("name"):
            # O nome exibido nos lançamentos é snapshot do cadastro: acompanha a correção.
            await db.fin_entries.update_many({"owner_id": owner, "contact_id": contact_id},
                                             {"$set": {"client_supplier": data["name"]}}, session=s)
        await log_event(current, action, module="config", entity_type="contato", entity_id=contact_id,
                        entity_label=after["name"], changes=changes, session=s)
    try:
        await in_transaction(tx)
    except DuplicateKeyError:
        raise _dup_error()
    return _out(await db.fin_contacts.find_one({"_id": before["_id"]}))


@contacts_router.delete("/{contact_id}")
async def delete_contact(contact_id: str, current=Depends(get_current_user)):
    owner = current["id"]
    doc = await db.fin_contacts.find_one({"owner_id": owner, "id": contact_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Cadastro não encontrado")
    em_uso = await contact_usage(owner, contact_id)
    if em_uso:
        raise HTTPException(status_code=409, detail={
            "code": "in_use", "count": em_uso,
            "msg": f"Este cadastro está vinculado a {em_uso} registro(s) e não pode ser excluído. "
                   "Inative-o para tirá-lo das novas seleções sem perder o histórico."})

    async def tx(s):
        await db.fin_contacts.delete_one({"_id": doc["_id"]}, session=s)
        await log_event(current, "contato_excluido", module="config", entity_type="contato", entity_id=contact_id,
                        entity_label=doc.get("name", ""), session=s)
    await in_transaction(tx)
    return {"ok": True}


async def create_contact_indexes() -> None:
    await db.fin_contacts.create_index([("owner_id", 1), ("id", 1)], unique=True)
    await db.fin_contacts.create_index([("owner_id", 1), ("search_key", 1)])
    # Um CPF/CNPJ por empresa (vazio é permitido em quantos cadastros forem).
    await db.fin_contacts.create_index([("owner_id", 1), ("document", 1)], unique=True,
                                       partialFilterExpression={"document": {"$type": "string"}})
    await db.fin_entries.create_index([("owner_id", 1), ("contact_id", 1)])
