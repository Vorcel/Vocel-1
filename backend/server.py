"""Main FastAPI application for Sistema de Licitações."""
import os
import logging

from bson import ObjectId
from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware

from db import db
from auth import auth_router, seed_admin
from storage import files_router, init_storage
from routes import api as core_router
from propostas import propostas_router
from gdrive import gdrive_router
from analytics import analytics_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

DEFAULT_STATUS_COLOR = "#64748B"

app = FastAPI(title="Sistema de Licitações")

app.include_router(auth_router)
app.include_router(files_router)
app.include_router(core_router)
app.include_router(propostas_router)
app.include_router(gdrive_router)
app.include_router(analytics_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


async def migrate_owner_isolation():
    """Backfill idempotente de owner_id para o isolamento multi-usuário.
    Não-destrutivo: apenas adiciona owner_id onde falta, preservando os dados existentes.
    - executions/budgets antigos herdam o owner_id do bid pai;
    - bids/registros órfãos e os singletons globais (company/preferences/params) vão para o admin."""
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@licita.com").lower()
    admin = await db.users.find_one({"email": admin_email})
    admin_id = str(admin["_id"]) if admin else None

    async def _owner_from_bid(bid_id: str):
        try:
            bid = await db.bids.find_one({"_id": ObjectId(bid_id)})
        except Exception:
            bid = None
        return (bid or {}).get("owner_id") or admin_id

    # bids órfãos -> admin
    if admin_id:
        await db.bids.update_many({"owner_id": {"$exists": False}}, {"$set": {"owner_id": admin_id}})

    # executions sem owner -> herda do bid pai
    n_exec = 0
    async for ex in db.executions.find({"owner_id": {"$exists": False}}):
        await db.executions.update_one({"_id": ex["_id"]}, {"$set": {"owner_id": await _owner_from_bid(ex.get("bid_id", ""))}})
        n_exec += 1

    # budgets sem owner -> herda do bid pai
    n_bud = 0
    async for bu in db.budgets.find({"owner_id": {"$exists": False}}):
        await db.budgets.update_one({"_id": bu["_id"]}, {"$set": {"owner_id": await _owner_from_bid(bu.get("bid_id", ""))}})
        n_bud += 1

    # singletons globais (company/preferences/params) -> admin
    if admin_id:
        for coll in (db.company, db.preferences, db.params):
            await coll.update_many(
                {"_key": "global", "owner_id": {"$exists": False}},
                {"$set": {"owner_id": admin_id}},
            )
    logger.info(f"Owner isolation migration: executions={n_exec}, budgets={n_bud} backfilled")


async def migrate_add_status(nome: str, cor: str, flag: str):
    """Adiciona um status à lista de cada usuário, uma única vez (flag por doc).
    Idempotente e não-destrutivo: só acrescenta se ainda não existir; se o usuário
    apagar o status depois, ele não volta (o flag impede re-inserção)."""
    n = 0
    async for p in db.params.find({flag: {"$ne": True}}):
        statuses = p.get("statuses", [])
        names = [s.get("nome") if isinstance(s, dict) else s for s in statuses]
        if nome not in names:
            statuses = list(statuses) + [{"nome": nome, "cor": cor}]
        await db.params.update_one({"_id": p["_id"]}, {"$set": {"statuses": statuses, flag: True}})
        n += 1
    logger.info(f"Status seed '{nome}': {n} usuário(s) processado(s)")


async def migrate_status_categories():
    """Backfill idempotente da Categoria Analítica nos status já cadastrados.
    Só preenche o que falta (ou o que está com valor inválido) usando o mapeamento
    inicial por nome; escolhas feitas pelo usuário em Configurações são preservadas.
    A categoria passa a viver no próprio registro do status, então renomear o
    status depois não altera a classificação usada na página Análises."""
    from routes import ANALYTIC_CATEGORIES, seed_category_for
    n = 0
    async for p in db.params.find({}):
        statuses = p.get("statuses", []) or []
        mudou = False
        novos = []
        for item in statuses:
            if isinstance(item, str):
                item = {"nome": item, "cor": DEFAULT_STATUS_COLOR}
                mudou = True
            else:
                item = dict(item)
            if item.get("categoria") not in ANALYTIC_CATEGORIES:
                item["categoria"] = seed_category_for(item.get("nome", ""))
                mudou = True
            novos.append(item)
        if mudou:
            await db.params.update_one({"_id": p["_id"]}, {"$set": {"statuses": novos}})
            n += 1
    logger.info(f"Categoria Analítica: {n} lista(s) de status atualizada(s)")


@app.on_event("startup")
async def startup():
    try:
        await db.users.create_index("email", unique=True)
        # Índices de isolamento por usuário (performance das consultas por owner_id)
        await db.bids.create_index("owner_id")
        # Consultas da página Análises: recorte por período (data da disputa /
        # data de referência do prazo) dentro do próprio usuário.
        await db.bids.create_index([("owner_id", 1), ("data_disputa", 1)])
        await db.executions.create_index([("owner_id", 1), ("data_referencia_entrega", 1)])
        await db.executions.create_index([("owner_id", 1), ("bid_id", 1)])
        await db.budgets.create_index([("owner_id", 1), ("bid_id", 1)])
        await db.files.create_index("owner_id")
        await db.params.create_index("owner_id")
        await db.company.create_index("owner_id")
        await db.preferences.create_index("owner_id")
        # Integração Google: uma conta por usuário (ver gdrive.py).
        await db.integrations.create_index([("owner_id", 1), ("provider", 1)], unique=True)
    except Exception as e:
        logger.warning(f"Index creation: {e}")
    await seed_admin()
    try:
        await migrate_owner_isolation()
    except Exception as e:
        logger.error(f"Owner isolation migration failed: {e}")
    try:
        await migrate_add_status("Encerrado", "#475569", "_encerrado_seeded")
    except Exception as e:
        logger.error(f"Status seed migration failed: {e}")
    try:
        await migrate_status_categories()
    except Exception as e:
        logger.error(f"Status category migration failed: {e}")
    try:
        init_storage()
        logger.info("Storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")


@app.on_event("shutdown")
async def shutdown():
    from db import client
    client.close()
