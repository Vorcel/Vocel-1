"""Núcleo do módulo Financeiro: dinheiro, datas, status, transações e auditoria.

Regras que valem para todo o Financeiro (financeiro.py e fin_recebiveis.py):
- Dinheiro é guardado em CENTAVOS inteiros (`*_cents`). Entrada aceita número ou
  texto ("1.234,56" / "1234.56") e é convertida com Decimal — nunca float.
- Datas financeiras (vencimento, pagamento, recebimento) são datas de CALENDÁRIO
  "YYYY-MM-DD", sem horário. "Hoje" é calculado em America/Sao_Paulo, então um
  vencimento 07/11 nunca vira 06/11 por causa de UTC.
- Timestamps do sistema (auditoria, created_at) são UTC ISO gerados pelo servidor;
  a interface converte para o fuso de São Paulo na exibição.
- Status ARMAZENADO: pendente | parcial | pago | recebido | cancelado. "parcial" =
  houve baixa(s) mas ainda há saldo. "Atrasado" é sempre DERIVADO (saldo em
  aberto + vencimento < hoje) — nunca gravado, para não ficar inconsistente com
  o calendário.
- Baixas (pagamentos/recebimentos, totais ou parciais) são registros próprios em
  `fin_settlements`; o lançamento guarda `settled_cents` (soma das baixas ativas,
  atualizada na MESMA transação de cada baixa/estorno). Saldo em aberto =
  amount_cents − settled_cents; o valor original nunca muda por causa de baixa.
- Toda escrita que precisa de auditoria roda em transação (Atlas é replica set):
  o lançamento e o evento de log entram juntos ou não entram."""
import calendar
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Awaitable, Callable, Optional

from fastapi import HTTPException

from db import client, db, now_iso

try:
    from zoneinfo import ZoneInfo
    SP_TZ = ZoneInfo("America/Sao_Paulo")
except Exception:  # Windows sem o pacote tzdata: Brasil não tem horário de verão desde 2019
    SP_TZ = timezone(timedelta(hours=-3))

# ---------------- status ----------------
PAGAR = "pagar"
RECEBER = "receber"
TYPES = (PAGAR, RECEBER)

PENDENTE = "pendente"
PAGO = "pago"
RECEBIDO = "recebido"
CANCELADO = "cancelado"
PARCIAL = "parcial"            # baixa parcial: ainda há saldo em aberto
ATRASADO = "atrasado"          # derivado, nunca gravado
SETTLED = (PAGO, RECEBIDO)     # quitados (saldo zero)
OPEN = (PENDENTE, PARCIAL)     # com saldo em aberto: entram em previsões, cards e fluxo

MODES = ("avista", "parcelado", "recorrente")

# Periodicidades da recorrência: (rótulo, meses, dias). Mensais ancoram no dia da
# 1ª data (31/01 -> 28/02 -> 31/03); as demais somam dias.
FREQUENCIES = {
    "semanal": ("Semanal", 0, 7),
    "quinzenal": ("Quinzenal", 0, 14),
    "mensal": ("Mensal", 1, 0),
    "bimestral": ("Bimestral", 2, 0),
    "trimestral": ("Trimestral", 3, 0),
    "semestral": ("Semestral", 6, 0),
    "anual": ("Anual", 12, 0),
}

MAX_OCCURRENCES = 360


def settled_status(tipo: str) -> str:
    return PAGO if tipo == PAGAR else RECEBIDO


# ---------------- dinheiro ----------------
def to_cents(value: Any, field: str = "valor", allow_zero: bool = False) -> int:
    """Converte número/texto em centavos inteiros (Decimal, arredondamento comercial)."""
    if value is None or value == "":
        raise HTTPException(status_code=400, detail=f"Informe o {field}.")
    if isinstance(value, bool):
        raise HTTPException(status_code=400, detail=f"{field.capitalize()} inválido.")
    if isinstance(value, int):
        d = Decimal(value)
    elif isinstance(value, float):
        d = Decimal(repr(value))
    else:
        s = str(value).strip().replace("R$", "").replace(" ", "")
        if "," in s:   # formato brasileiro: 1.234,56
            s = s.replace(".", "").replace(",", ".")
        try:
            d = Decimal(s)
        except InvalidOperation:
            raise HTTPException(status_code=400, detail=f"{field.capitalize()} inválido.")
    cents = int((d * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    if cents < 0 or (cents == 0 and not allow_zero):
        raise HTTPException(status_code=400, detail=f"O {field} deve ser maior que zero.")
    return cents


def signed_cents(value: Any, field: str = "saldo") -> int:
    """Como to_cents, mas aceita negativo e zero (saldo bancário pode estar no vermelho)."""
    if value is None or value == "":
        return 0
    neg = str(value).strip().startswith("-")
    raw = str(value).strip().lstrip("-") if not isinstance(value, (int, float)) else abs(value)
    cents = to_cents(raw, field, allow_zero=True)
    return -cents if neg else cents


def split_installments(total_cents: int, n: int) -> list:
    """Divide o total em n parcelas que somam EXATAMENTE o total.
    R$ 1.000,00 / 3 -> 333,33 + 333,33 + 333,34 (a diferença vai na última)."""
    base = total_cents // n
    parts = [base] * n
    parts[-1] += total_cents - base * n
    return parts


def brl(cents: int) -> str:
    neg = cents < 0
    c = abs(int(cents))
    inteiro = f"{c // 100:,}".replace(",", ".")
    return f"{'-' if neg else ''}R$ {inteiro},{c % 100:02d}"


# ---------------- datas ----------------
def today_sp() -> str:
    return datetime.now(SP_TZ).date().isoformat()


def parse_date(value: Any, field: str = "data") -> str:
    try:
        return date.fromisoformat(str(value)[:10]).isoformat()
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"{field.capitalize()} inválida.")


def add_months(iso: str, months: int, anchor_day: Optional[int] = None) -> str:
    d = date.fromisoformat(iso)
    y, m = divmod(d.month - 1 + months, 12)
    y, m = d.year + y, m + 1
    day = min(anchor_day or d.day, calendar.monthrange(y, m)[1])
    return date(y, m, day).isoformat()


def occurrence_dates(first: str, n: int, frequency: str) -> list:
    if frequency not in FREQUENCIES:
        raise HTTPException(status_code=400, detail="Periodicidade inválida.")
    _, months, days = FREQUENCIES[frequency]
    anchor = date.fromisoformat(first).day
    out = []
    for i in range(n):
        if months:
            out.append(add_months(first, months * i, anchor))
        else:
            out.append((date.fromisoformat(first) + timedelta(days=days * i)).isoformat())
    return out


def shift_days(iso: str, delta: int) -> str:
    return (date.fromisoformat(iso) + timedelta(days=delta)).isoformat()


def days_between(a: str, b: str) -> int:
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def effective_status(entry: dict, today: Optional[str] = None) -> str:
    st = entry.get("status", PENDENTE)
    if st in OPEN and (entry.get("due_date") or "9999") < (today or today_sp()):
        return ATRASADO
    return st


def open_cents(entry: dict) -> int:
    return int(entry.get("amount_cents") or 0) - int(entry.get("settled_cents") or 0)


# Expressão de agregação do saldo em aberto (amount − baixas), para somas no Mongo.
OPEN_EXPR = {"$subtract": ["$amount_cents", {"$ifNull": ["$settled_cents", 0]}]}


def new_id() -> str:
    return uuid.uuid4().hex


# ---------------- transação ----------------
async def in_transaction(fn: Callable[[Any], Awaitable[Any]]):
    """Executa `fn(session)` numa transação (com as re-tentativas do driver para
    erros transitórios). Tudo que `fn` grava usando `session=` entra junto."""
    async with await client.start_session() as s:
        return await s.with_transaction(fn)


# ---------------- auditoria ----------------
MODULES = {
    "pagar": "A Pagar",
    "receber": "A Receber",
    "bancos": "Bancos",
    "config": "Configurações",
    "execucao": "Execução",
    "licitacoes": "Licitações",
    "usuarios": "Usuários",
}


def actor(current: dict) -> dict:
    """Quem REALMENTE agiu (usuário principal ou interno). `owner_id` do evento
    continua sendo a conta (current["id"])."""
    return {"user_id": current.get("actor_id") or current["id"],
            "user_name": current.get("actor_name") or current.get("name") or current.get("email") or "",
            "user_login": current.get("actor_login") or current.get("email") or "",
            "user_type": "owner" if current.get("is_owner", True) else "internal"}


async def log_event(current: dict, action: str, *, module: str, entity_type: str, entity_id: str,
                    entity_label: str = "", changes: Optional[list] = None, amount_cents: Optional[int] = None,
                    financial_date: Optional[str] = None, origin: str = "Financeiro",
                    metadata: Optional[dict] = None, session=None) -> None:
    """Registra UM evento imutável no histórico do Financeiro.
    `ts` é sempre o horário do servidor no momento da ação — nunca a data
    financeira informada pelo usuário, que vai em `financial_date`."""
    await db.fin_audit.insert_one({
        "id": new_id(),
        "owner_id": current["id"],
        **actor(current),
        "ts": now_iso(),
        "action": action,
        "module": module,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "entity_label": entity_label,
        "changes": changes or [],
        "amount_cents": amount_cents,
        "financial_date": financial_date,
        "origin": origin,
        "metadata": metadata or {},
    }, session=session)


def diff(before: dict, after: dict, labels: dict) -> list:
    """Campos alterados [{field, label, before, after}] — só o que mudou."""
    out = []
    for field, label in labels.items():
        b, a = before.get(field), after.get(field)
        if field in after and (b or None) != (a or None):
            out.append({"field": field, "label": label, "before": b, "after": a})
    return out


def utc_now() -> datetime:
    return datetime.now(timezone.utc)
